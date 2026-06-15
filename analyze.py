"""Experimental real OpenCV wound-photo comparison for /analyze-real.

This compares yesterday/today photos and reports a measurable VISUAL CHANGE
score (redness area + bounding-box growth). It reports change only — never a
diagnosis, and never the word "infection".

Scoring approach: growth-direction-filtered multi-threshold on a central ROI.
Low saturation thresholds tend to capture skin/lighting/background warmth
rather than a true red mark, and that noise can point the "wrong way"
(yesterday redder than today). So we run several saturation thresholds, keep
only those that show genuine positive red growth on a centred crop, and take
the median of their scores. See analyze_pair for the exact steps.

Demo limitations (read before trusting the numbers):
  * This is a controlled-demo CV pipeline, not a clinical tool.
  * It does NOT do wound segmentation — it masks red-ish pixels in a crop.
  * It does NOT normalize lighting, scale, or angle.
  * It assumes both photos use similar distance, lighting, and framing.
  * The /capture-check endpoint and the frontend wound-guide frame improve
    capture quality but do not guarantee clinical comparability or true scale
    normalization.
  * Because v1 has no scale correction, DISTANCE IS CRITICAL: the same phone
    distance, angle, lighting, and framing must be used. Distance variation
    can dominate pixel-area changes and swamp any real wound change.

The /analyze mock endpoint stays the demo safety net; this is separate.
"""

import statistics

import cv2
import numpy as np

# Pipeline constants.
TARGET_WIDTH = 800
SATURATION_MIN = 80  # default S floor for redness_mask (S>80, not 60, keeps
VALUE_MIN = 50       # normal skin incl. Indian skin tones from counting as red)
KERNEL = np.ones((5, 5), np.uint8)  # small kernel for noise cleanup
MIN_DENOMINATOR = 50  # floor on yesterday areas so deltas don't explode
DISCLAIMER = "This checks visual change between photos only. It is not a medical diagnosis."

# Growth-direction-filtered multi-threshold scoring.
SATURATION_THRESHOLDS = [80, 100, 120]
MIN_RED_AREA_PIXELS = 100  # ignore thresholds with too little yesterday red
ROI_FRACTION = 0.85  # central 85% width and height

# Pair-level comparability warnings. These are debug-only and do not affect
# visual metrics or scoring.
BRIGHTNESS_MISMATCH_THRESHOLD = 35.0
LOW_SATURATION_ROI_THRESHOLD = 25.0
TINY_VISUAL_REGION_FRACTION = 0.005

# Debug-only visual-region localization. These values do not affect visual
# metrics, warnings, experimental features, or scoring.
MIN_LOCALIZED_VISUAL_REGION_PIXELS = 100
VISUAL_REGION_PADDING_PX = 12

# Supporting non-diagnostic visual features (dark / yellow / combined region).
# These describe visual area change only — never necrosis, pus, slough, or
# depth. Dark = very low brightness; yellow/cream = warm mid-hue region.
DARK_VALUE_MAX = 60       # HSV V (or grayscale) below this counts as "dark"
YELLOW_HUE_LOW = 18
YELLOW_HUE_HIGH = 45
YELLOW_SAT_MIN = 40
YELLOW_VALUE_MIN = 80


class AnalyzeError(Exception):
    """Raised when an image can't be decoded or the pair can't be analysed.

    The HTTP layer turns this into a 400 JSON error response.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def decode_image(image_bytes: bytes) -> np.ndarray:
    """Decode raw bytes into a BGR image, or raise AnalyzeError.

    cv2.imdecode does not handle HEIC; callers should use JPG or PNG.
    """
    buffer = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise AnalyzeError("Could not decode one or both images. Please use JPG or PNG images.")
    return image


def resize_to_width(image: np.ndarray, width: int = TARGET_WIDTH) -> np.ndarray:
    """Resize to `width` px, preserving aspect ratio."""
    height, original_width = image.shape[:2]
    scale = width / original_width
    return cv2.resize(image, (width, max(1, round(height * scale))), interpolation=cv2.INTER_AREA)


def central_roi(image: np.ndarray, fraction: float = ROI_FRACTION) -> np.ndarray:
    """Crop the central `fraction` of width and height.

    The frontend wound-guide frame asks the caregiver to centre the wound, so
    a central crop focuses on the wound and ignores background/edge warmth.
    """
    height, width = image.shape[:2]
    crop_w = int(width * fraction)
    crop_h = int(height * fraction)
    x0 = (width - crop_w) // 2
    y0 = (height - crop_h) // 2
    return image[y0:y0 + crop_h, x0:x0 + crop_w]


def image_size(image: np.ndarray) -> dict[str, int]:
    """Return image dimensions as width/height metadata."""
    height, width = image.shape[:2]
    return {"width": int(width), "height": int(height)}


def central_roi_coordinates(image: np.ndarray, fraction: float = ROI_FRACTION) -> dict[str, int]:
    """Return the central ROI coordinates relative to the source image."""
    height, width = image.shape[:2]
    crop_w = int(width * fraction)
    crop_h = int(height * fraction)
    x0 = (width - crop_w) // 2
    y0 = (height - crop_h) // 2
    return {"x": x0, "y": y0, "width": crop_w, "height": crop_h}


def convert_color_spaces(image_bgr: np.ndarray) -> dict[str, np.ndarray]:
    """Convert one BGR image into the color spaces used for visual analysis."""
    return {
        "bgr": image_bgr,
        "rgb": cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB),
        "hsv": cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV),
        "lab": cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB),
        "ycrcb": cv2.cvtColor(image_bgr, cv2.COLOR_BGR2YCrCb),
        "gray": cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY),
    }


def redness_mask(
    image_bgr: np.ndarray,
    saturation_min: int = SATURATION_MIN,
    color_spaces: dict[str, np.ndarray] | None = None,
) -> np.ndarray:
    """Binary mask of red-ish pixels using two HSV hue bands around red.

    `saturation_min` is exposed so callers can sweep it. Higher values exclude
    more normal skin.
    """
    hsv = (color_spaces or convert_color_spaces(image_bgr))["hsv"]
    lower_red = cv2.inRange(hsv, np.array([0, saturation_min, VALUE_MIN]), np.array([15, 255, 255]))
    upper_red = cv2.inRange(hsv, np.array([160, saturation_min, VALUE_MIN]), np.array([180, 255, 255]))
    mask = cv2.bitwise_or(lower_red, upper_red)
    # Opening removes specks; closing fills small holes.
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, KERNEL)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, KERNEL)
    return mask


def red_area(mask: np.ndarray) -> int:
    """Number of red pixels in the mask."""
    return int(cv2.countNonZero(mask))


def bounding_box_area(mask: np.ndarray) -> int:
    """Area of a single bounding box around ALL red pixels combined.

    Not per-component — one box over every red pixel. 0 if there are none.
    """
    points = cv2.findNonZero(mask)
    if points is None:
        return 0
    _x, _y, width, height = cv2.boundingRect(points)
    return int(width * height)


def dark_mask(
    image_bgr: np.ndarray, color_spaces: dict[str, np.ndarray] | None = None
) -> np.ndarray:
    """Mask of very dark visual regions (low brightness) in the ROI.

    Non-diagnostic: this is "dark visual area" only, never necrosis or depth.
    """
    hsv = (color_spaces or convert_color_spaces(image_bgr))["hsv"]
    mask = cv2.inRange(hsv, np.array([0, 0, 0]), np.array([180, 255, DARK_VALUE_MAX]))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, KERNEL)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, KERNEL)
    return mask


def yellow_mask(
    image_bgr: np.ndarray, color_spaces: dict[str, np.ndarray] | None = None
) -> np.ndarray:
    """Mask of yellow/cream visual regions in the ROI.

    Non-diagnostic: this is "yellow/cream visual area" only, never pus or slough.
    """
    hsv = (color_spaces or convert_color_spaces(image_bgr))["hsv"]
    mask = cv2.inRange(
        hsv,
        np.array([YELLOW_HUE_LOW, YELLOW_SAT_MIN, YELLOW_VALUE_MIN]),
        np.array([YELLOW_HUE_HIGH, 255, 255]),
    )
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, KERNEL)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, KERNEL)
    return mask


def area_delta_pct(yesterday_area: int, today_area: int) -> float:
    """Percentage area increase from yesterday to today, clamped to 0-100.

    Uses the same MIN_DENOMINATOR floor as redness so a near-empty yesterday
    can't explode the value; negative (shrinking) deltas clamp to 0.
    """
    raw = ((today_area - yesterday_area) / max(yesterday_area, MIN_DENOMINATOR)) * 100
    return round(clamp(raw), 2)


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    """Clamp `value` into [low, high]."""
    return max(low, min(high, value))


def score_at_threshold(
    yesterday_roi: np.ndarray,
    today_roi: np.ndarray,
    saturation: int,
    yesterday_color_spaces: dict[str, np.ndarray] | None = None,
    today_color_spaces: dict[str, np.ndarray] | None = None,
) -> dict[str, object]:
    """Run the redness comparison at one saturation threshold.

    Returns a per-threshold result dict including the unclamped
    raw_redness_delta (used for the growth-direction filter), the clamped
    redness_delta/border_change, the change_score, and why it was kept or
    excluded.
    """
    yesterday_mask = redness_mask(
        yesterday_roi,
        saturation_min=saturation,
        color_spaces=yesterday_color_spaces,
    )
    today_mask = redness_mask(
        today_roi,
        saturation_min=saturation,
        color_spaces=today_color_spaces,
    )

    yesterday_red = red_area(yesterday_mask)
    today_red = red_area(today_mask)
    raw_redness_delta = ((today_red - yesterday_red) / max(yesterday_red, MIN_DENOMINATOR)) * 100
    redness_delta = clamp(raw_redness_delta)

    yesterday_bbox = bounding_box_area(yesterday_mask)
    today_bbox = bounding_box_area(today_mask)
    border_change = clamp(((today_bbox - yesterday_bbox) / max(yesterday_bbox, MIN_DENOMINATOR)) * 100)

    change_score = max(redness_delta, border_change)

    # Keep only thresholds that show genuine positive red growth with enough
    # yesterday red to be a real mark (not lighting/white-balance drift).
    if raw_redness_delta <= 0:
        excluded_reason: str | None = "negative_or_zero_growth"
    elif yesterday_red < MIN_RED_AREA_PIXELS:
        excluded_reason = "red_area_too_small"
    else:
        excluded_reason = None

    return {
        "s_threshold": saturation,
        "yesterday_red_area": yesterday_red,
        "today_red_area": today_red,
        "raw_redness_delta": round(raw_redness_delta, 2),
        "redness_delta": round(redness_delta, 2),
        "border_change": round(border_change, 2),
        "change_score": round(change_score, 2),
        "used_for_score": excluded_reason is None,
        "excluded_reason": excluded_reason,
    }


def compute_visual_features(
    yesterday_roi: np.ndarray,
    today_roi: np.ndarray,
    red_saturation: int,
    yesterday_color_spaces: dict[str, np.ndarray] | None = None,
    today_color_spaces: dict[str, np.ndarray] | None = None,
) -> dict[str, object]:
    """Compute supporting non-diagnostic visual-area metrics on the ROI.

    `red_saturation` is the redness threshold selected by the primary scorer
    (or the default when none was selected), used for the combined region. All
    deltas are area increases clamped to 0-100. Reports visual area only —
    never necrosis, pus, slough, or depth.
    """
    dark_y_mask = dark_mask(yesterday_roi, color_spaces=yesterday_color_spaces)
    dark_t_mask = dark_mask(today_roi, color_spaces=today_color_spaces)
    yellow_y_mask = yellow_mask(yesterday_roi, color_spaces=yesterday_color_spaces)
    yellow_t_mask = yellow_mask(today_roi, color_spaces=today_color_spaces)
    red_y_mask = redness_mask(
        yesterday_roi,
        saturation_min=red_saturation,
        color_spaces=yesterday_color_spaces,
    )
    red_t_mask = redness_mask(
        today_roi,
        saturation_min=red_saturation,
        color_spaces=today_color_spaces,
    )

    # Approximate visual region = red OR dark OR yellow (not true segmentation).
    combined_y_mask = cv2.bitwise_or(cv2.bitwise_or(red_y_mask, dark_y_mask), yellow_y_mask)
    combined_t_mask = cv2.bitwise_or(cv2.bitwise_or(red_t_mask, dark_t_mask), yellow_t_mask)

    dark_y, dark_t = red_area(dark_y_mask), red_area(dark_t_mask)
    yellow_y, yellow_t = red_area(yellow_y_mask), red_area(yellow_t_mask)
    combined_y, combined_t = red_area(combined_y_mask), red_area(combined_t_mask)
    combined_bbox_y = bounding_box_area(combined_y_mask)
    combined_bbox_t = bounding_box_area(combined_t_mask)

    return {
        "dark_area_delta": area_delta_pct(dark_y, dark_t),
        "yellow_area_delta": area_delta_pct(yellow_y, yellow_t),
        "wound_area_delta": area_delta_pct(combined_y, combined_t),
        "combined_border_change": area_delta_pct(combined_bbox_y, combined_bbox_t),
        # Raw areas for the debug object.
        "dark_area_yesterday": dark_y,
        "dark_area_today": dark_t,
        "yellow_area_yesterday": yellow_y,
        "yellow_area_today": yellow_t,
        "combined_area_yesterday": combined_y,
        "combined_area_today": combined_t,
        "combined_bbox_yesterday": combined_bbox_y,
        "combined_bbox_today": combined_bbox_t,
        # Internal masks reused by debug-only visual-region localization.
        "_combined_mask_yesterday": combined_y_mask,
        "_combined_mask_today": combined_t_mask,
    }


def comparability_warnings(
    yesterday_color_spaces: dict[str, np.ndarray],
    today_color_spaces: dict[str, np.ndarray],
    features: dict[str, object],
) -> list[str]:
    """Return non-blocking warnings about whether the ROI pair is comparable."""
    yesterday_brightness = float(yesterday_color_spaces["gray"].mean())
    today_brightness = float(today_color_spaces["gray"].mean())
    yesterday_saturation = float(yesterday_color_spaces["hsv"][:, :, 1].mean())
    today_saturation = float(today_color_spaces["hsv"][:, :, 1].mean())

    yesterday_visual_area = int(features["combined_area_yesterday"])
    today_visual_area = int(features["combined_area_today"])
    yesterday_visual_fraction = yesterday_visual_area / max(
        int(yesterday_color_spaces["gray"].size), 1
    )
    today_visual_fraction = today_visual_area / max(int(today_color_spaces["gray"].size), 1)
    minimum_visual_fraction = min(yesterday_visual_fraction, today_visual_fraction)

    warnings: list[str] = []
    if abs(today_brightness - yesterday_brightness) >= BRIGHTNESS_MISMATCH_THRESHOLD:
        warnings.append("brightness_mismatch_between_images")
    if min(yesterday_saturation, today_saturation) < LOW_SATURATION_ROI_THRESHOLD:
        warnings.append("low_saturation_roi")
    if yesterday_visual_area == 0 or today_visual_area == 0:
        warnings.append("empty_visual_mask")
    elif minimum_visual_fraction < TINY_VISUAL_REGION_FRACTION:
        warnings.append("tiny_visual_region")
    if warnings:
        warnings.append("images_may_not_be_comparable")
    return warnings


def brightness_delta(
    yesterday_color_spaces: dict[str, np.ndarray],
    today_color_spaces: dict[str, np.ndarray],
) -> float:
    """Absolute difference in mean grayscale brightness between the two ROIs."""
    yesterday_mean = float(yesterday_color_spaces["gray"].mean())
    today_mean = float(today_color_spaces["gray"].mean())
    return round(abs(today_mean - yesterday_mean), 2)


def lab_color_delta(
    yesterday_color_spaces: dict[str, np.ndarray],
    today_color_spaces: dict[str, np.ndarray],
) -> float:
    """Euclidean distance between the mean LAB channel values of both ROIs."""
    yesterday_mean = yesterday_color_spaces["lab"].mean(axis=(0, 1))
    today_mean = today_color_spaces["lab"].mean(axis=(0, 1))
    return round(float(np.linalg.norm(today_mean - yesterday_mean)), 2)


def edge_change(
    yesterday_color_spaces: dict[str, np.ndarray],
    today_color_spaces: dict[str, np.ndarray],
) -> float:
    """Absolute percentage change in Canny edge-pixel count between both ROIs."""
    yesterday_edges = cv2.Canny(yesterday_color_spaces["gray"], 100, 200)
    today_edges = cv2.Canny(today_color_spaces["gray"], 100, 200)
    yesterday_count = int(cv2.countNonZero(yesterday_edges))
    today_count = int(cv2.countNonZero(today_edges))
    change = abs(today_count - yesterday_count) / max(yesterday_count, 1) * 100
    return round(change, 2)


def histogram_change(
    yesterday_color_spaces: dict[str, np.ndarray],
    today_color_spaces: dict[str, np.ndarray],
) -> float:
    """Bhattacharyya distance between normalized 2D HSV histograms."""
    yesterday_hist = cv2.calcHist(
        [yesterday_color_spaces["hsv"]], [0, 1], None, [50, 60], [0, 180, 0, 256]
    )
    today_hist = cv2.calcHist(
        [today_color_spaces["hsv"]], [0, 1], None, [50, 60], [0, 180, 0, 256]
    )
    cv2.normalize(yesterday_hist, yesterday_hist, alpha=1.0, norm_type=cv2.NORM_L1)
    cv2.normalize(today_hist, today_hist, alpha=1.0, norm_type=cv2.NORM_L1)
    distance = cv2.compareHist(yesterday_hist, today_hist, cv2.HISTCMP_BHATTACHARYYA)
    return round(float(distance), 2)


def compute_experimental_features(
    yesterday_color_spaces: dict[str, np.ndarray],
    today_color_spaces: dict[str, np.ndarray],
) -> dict[str, float]:
    """Compute debug-only non-diagnostic visual features for the ROI pair."""
    return {
        "brightness_delta": brightness_delta(yesterday_color_spaces, today_color_spaces),
        "lab_color_delta": lab_color_delta(yesterday_color_spaces, today_color_spaces),
        "edge_change": edge_change(yesterday_color_spaces, today_color_spaces),
        "histogram_change": histogram_change(yesterday_color_spaces, today_color_spaces),
    }


def largest_visual_region(mask: np.ndarray) -> tuple[dict[str, int] | None, int]:
    """Return the largest meaningful connected visual region and its pixel area."""
    count, _labels, stats, _centroids = cv2.connectedComponentsWithStats(
        (mask > 0).astype(np.uint8), connectivity=8
    )
    if count <= 1:
        return None, 0

    largest_label = max(
        range(1, count),
        key=lambda label: int(stats[label, cv2.CC_STAT_AREA]),
    )
    area = int(stats[largest_label, cv2.CC_STAT_AREA])
    if area < MIN_LOCALIZED_VISUAL_REGION_PIXELS:
        return None, area

    return (
        {
            "x": int(stats[largest_label, cv2.CC_STAT_LEFT]),
            "y": int(stats[largest_label, cv2.CC_STAT_TOP]),
            "width": int(stats[largest_label, cv2.CC_STAT_WIDTH]),
            "height": int(stats[largest_label, cv2.CC_STAT_HEIGHT]),
        },
        area,
    )


def padded_region_box(
    box: dict[str, int], mask: np.ndarray, padding_px: int = VISUAL_REGION_PADDING_PX
) -> dict[str, int]:
    """Pad a visual-region box while keeping it inside the resized central ROI."""
    roi_height, roi_width = mask.shape[:2]
    x0 = max(0, box["x"] - padding_px)
    y0 = max(0, box["y"] - padding_px)
    x1 = min(roi_width, box["x"] + box["width"] + padding_px)
    y1 = min(roi_height, box["y"] + box["height"] + padding_px)
    return {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}


def visual_region_localization(
    yesterday_mask: np.ndarray, today_mask: np.ndarray
) -> dict[str, object]:
    """Build debug-only localization metadata from the combined visual masks."""
    yesterday_box, yesterday_area = largest_visual_region(yesterday_mask)
    today_box, today_area = largest_visual_region(today_mask)

    missing_yesterday = yesterday_box is None
    missing_today = today_box is None
    used_localized_region = not missing_yesterday and not missing_today

    if used_localized_region:
        fallback_reason = None
        yesterday_output_box = padded_region_box(yesterday_box, yesterday_mask)
        today_output_box = padded_region_box(today_box, today_mask)
    else:
        if missing_yesterday and missing_today:
            fallback_reason = "no_meaningful_visual_region_in_both_images"
        elif missing_yesterday:
            fallback_reason = "no_meaningful_visual_region_in_yesterday_image"
        else:
            fallback_reason = "no_meaningful_visual_region_in_today_image"
        yesterday_height, yesterday_width = yesterday_mask.shape[:2]
        today_height, today_width = today_mask.shape[:2]
        yesterday_output_box = {
            "x": 0,
            "y": 0,
            "width": int(yesterday_width),
            "height": int(yesterday_height),
        }
        today_output_box = {
            "x": 0,
            "y": 0,
            "width": int(today_width),
            "height": int(today_height),
        }

    yesterday_fraction = yesterday_area / max(int(yesterday_mask.size), 1)
    today_fraction = today_area / max(int(today_mask.size), 1)
    return {
        "method": "combined_visual_mask_largest_region",
        "coordinate_space": "resized_central_roi",
        "used_localized_region": used_localized_region,
        "fallback_reason": fallback_reason,
        "yesterday_visual_region_box": yesterday_output_box,
        "today_visual_region_box": today_output_box,
        "visual_region_area_yesterday": yesterday_area,
        "visual_region_area_today": today_area,
        "visual_region_area_fraction_yesterday": round(yesterday_fraction, 4),
        "visual_region_area_fraction_today": round(today_fraction, 4),
        "padding_px": VISUAL_REGION_PADDING_PX,
    }


def analyze_pair(yesterday_bytes: bytes, today_bytes: bytes) -> dict[str, object]:
    """Compare two wound photos and return a visual-change result dict.

    Steps:
      1. Decode + resize to width 800, then crop the central 85% ROI.
      2. Redness (primary, unchanged): score at saturation thresholds 80, 100,
         120; keep thresholds with positive red growth and enough yesterday
         red; redness_score = MEDIAN of valid scores (0 if none pass). The shown
         redness_delta/border_change come from the threshold closest to that
         median.
      3. Supporting non-diagnostic features (dark / yellow / combined region)
         on the SAME ROI, using the selected redness threshold for the combined
         mask. These never claim necrosis, pus, slough, or depth.
      4. final change_score = max(redness_score, visual_support_score), where
         visual_support_score = max(wound_area_delta, combined_border_change).
         dark/yellow are returned as supporting/debug fields only and never
         drive the headline score on their own.

    Raises AnalyzeError if either image fails to decode.
    """
    yesterday_original = decode_image(yesterday_bytes)
    today_original = decode_image(today_bytes)
    yesterday_resized = resize_to_width(yesterday_original)
    today_resized = resize_to_width(today_original)
    yesterday_roi_coordinates = central_roi_coordinates(yesterday_resized)
    today_roi_coordinates = central_roi_coordinates(today_resized)
    yesterday = central_roi(yesterday_resized)
    today = central_roi(today_resized)
    yesterday_color_spaces = convert_color_spaces(yesterday)
    today_color_spaces = convert_color_spaces(today)

    threshold_results = [
        score_at_threshold(
            yesterday,
            today,
            s,
            yesterday_color_spaces=yesterday_color_spaces,
            today_color_spaces=today_color_spaces,
        )
        for s in SATURATION_THRESHOLDS
    ]
    valid_results = [result for result in threshold_results if result["used_for_score"]]

    # --- Primary redness score (existing behavior, unchanged) ---
    if valid_results:
        valid_scores = [result["change_score"] for result in valid_results]
        redness_score = statistics.median(valid_scores)
        # Pick the valid result closest to the median; on a tie prefer the
        # higher score (high sensitivity — better to over-flag than miss change).
        selected = min(
            valid_results,
            key=lambda result: (abs(result["change_score"] - redness_score), -result["change_score"]),
        )
        selected_threshold = selected["s_threshold"]
        redness_delta = selected["redness_delta"]
        border_change = selected["border_change"]
        redness_note = (
            "redness_score is the median over growth-positive thresholds; "
            "redness_delta and border_change are from the threshold closest to that median."
        )
    else:
        # Preserve the conservative no-growth behavior for the redness portion.
        redness_score = 0.0
        selected_threshold = None
        redness_delta = 0.0
        border_change = 0.0
        redness_note = "No positive red-growth direction detected."

    # --- Supporting non-diagnostic visual features ---
    # Combined region uses the selected red threshold (default when none chosen).
    features = compute_visual_features(
        yesterday,
        today,
        selected_threshold or SATURATION_MIN,
        yesterday_color_spaces=yesterday_color_spaces,
        today_color_spaces=today_color_spaces,
    )
    visual_support_score = max(features["wound_area_delta"], features["combined_border_change"])
    change_score = max(redness_score, visual_support_score)
    warnings = comparability_warnings(yesterday_color_spaces, today_color_spaces, features)
    experimental_features = compute_experimental_features(
        yesterday_color_spaces, today_color_spaces
    )
    localization = visual_region_localization(
        features["_combined_mask_yesterday"],
        features["_combined_mask_today"],
    )

    debug: dict[str, object] = {
        "method": "multi_feature_visual_change_roi",
        "roi": "central_85_percent",
        "thresholds": list(SATURATION_THRESHOLDS),
        "selected_threshold": selected_threshold,
        "valid_thresholds": [result["s_threshold"] for result in valid_results],
        "threshold_results": threshold_results,
        "redness_score": round(redness_score, 2),
        "visual_support_score": round(visual_support_score, 2),
        "dark_area_yesterday": features["dark_area_yesterday"],
        "dark_area_today": features["dark_area_today"],
        "yellow_area_yesterday": features["yellow_area_yesterday"],
        "yellow_area_today": features["yellow_area_today"],
        "combined_area_yesterday": features["combined_area_yesterday"],
        "combined_area_today": features["combined_area_today"],
        "combined_bbox_yesterday": features["combined_bbox_yesterday"],
        "combined_bbox_today": features["combined_bbox_today"],
        "redness_note": redness_note,
        "note": "non-diagnostic visual features only",
        "warnings": warnings,
        "color_spaces_used": ["BGR", "RGB", "HSV", "LAB", "YCrCb", "grayscale"],
        "experimental_features": experimental_features,
        "visual_region_localization": localization,
        "preprocessing": {
            "target_width": TARGET_WIDTH,
            "roi_fraction": ROI_FRACTION,
            "roi_method": "central_crop",
            "yesterday_original_size": image_size(yesterday_original),
            "today_original_size": image_size(today_original),
            "yesterday_resized_size": image_size(yesterday_resized),
            "today_resized_size": image_size(today_resized),
            "yesterday_roi_coordinates": yesterday_roi_coordinates,
            "today_roi_coordinates": today_roi_coordinates,
        },
    }

    return {
        "change_score": round(change_score, 2),
        "redness_delta": redness_delta,
        "border_change": border_change,
        "dark_area_delta": features["dark_area_delta"],
        "yellow_area_delta": features["yellow_area_delta"],
        "wound_area_delta": features["wound_area_delta"],
        "combined_border_change": features["combined_border_change"],
        "mock": False,
        "disclaimer": DISCLAIMER,
        "debug": debug,
    }
