"""Shared iris-based gaze helpers.

Iris landmarks are more robust than the eye-look blendshapes, especially with
glasses and low light — the blendshape scores become noise there while the
landmark geometry stays usable. Sign conventions match the rest of the pose
pipeline: +x gaze = subject's LEFT, gaze_h-style scalar + = looking RIGHT.
"""
import numpy as np


def pupil_dx(iris, inner, outer) -> float:
    """Pupil displacement along the eye axis, + = toward the outer corner."""
    w = outer[0] - inner[0]
    return (iris[0] - inner[0]) / w - 0.5 if abs(w) > 1e-6 else 0.0


def iris_gaze_h(landmarks) -> float:
    """Horizontal gaze from iris landmarks, + = looking RIGHT.

    Averaged pupil displacement of both eyes, negated (raw is + = left) and
    scaled x4 so its range (~+-2) matches the blendshape gaze_h scale that
    the existing thresholds expect.
    """
    def lm(i):
        p = landmarks[i]
        return p.x, p.y

    l_out, l_in = lm(33), lm(133)    # left eye outer/inner corners
    r_in, r_out = lm(362), lm(263)   # right eye inner/outer corners
    l_iris, r_iris = lm(468), lm(473)

    gaze_x = (pupil_dx(l_iris, l_in, l_out) - pupil_dx(r_iris, r_in, r_out)) / 2
    return float(-gaze_x * 4.0)


def compute_gaze_vector(landmarks, yaw_deg: float, pitch_deg: float) -> dict:
    """2D gaze direction for visualization, +x = subject's LEFT, +y = DOWN.

    Combines pupil displacement (iris vs eye corners) with head orientation.
    Returns {x, y, dx, dy} in normalized image coordinates.
    """
    def lm(i):
        p = landmarks[i]
        return p.x, p.y

    l_out, l_in = lm(33), lm(133)
    r_in, r_out = lm(362), lm(263)
    l_iris, r_iris = lm(468), lm(473)

    def pupil_dy(iris, inner, outer) -> float:
        # vertical offset of the iris from the line through the eye corners,
        # normalized by eye width. Corners are skull-anchored, so this does
        # NOT move with the gaze (eyelids do, which flips the sign).
        w = outer[0] - inner[0]
        if abs(w) < 1e-6:
            return 0.0
        y_line = inner[1] + (iris[0] - inner[0]) * (outer[1] - inner[1]) / w
        return (iris[1] - y_line) / abs(w)

    gaze_x = (pupil_dx(l_iris, l_in, l_out) - pupil_dx(r_iris, r_in, r_out)) / 2
    gaze_y = (pupil_dy(l_iris, l_in, l_out) + pupil_dy(r_iris, r_in, r_out)) / 2

    dx = float(np.clip(gaze_x * 2.0 + yaw_deg / 60.0, -1.2, 1.2))
    dy = float(np.clip(gaze_y * 2.0 - pitch_deg / 60.0, -1.2, 1.2))

    l_center = ((l_out[0] + l_in[0]) / 2, (l_out[1] + l_in[1]) / 2)
    r_center = ((r_out[0] + r_in[0]) / 2, (r_out[1] + r_in[1]) / 2)
    base = ((l_center[0] + r_center[0]) / 2, (l_center[1] + r_center[1]) / 2)
    return {"x": base[0], "y": base[1], "dx": dx, "dy": dy}
