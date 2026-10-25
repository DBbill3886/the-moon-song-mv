from PIL import Image
import numpy as np
import glob

for p in sorted(glob.glob('/workspace/moon-song-mv/assets/shot-*.jpg')):
    im = Image.open(p).convert('RGB')
    arr = np.array(im, dtype=np.float32)
    h, w, _ = arr.shape
    # Find bright warm amber pixels (R > 210, G > 140, B < 160, R - B > 60) in lower/mid half for device
    warm = (arr[:,:,0] > 210) & (arr[:,:,1] > 130) & (arr[:,:,0] - arr[:,:,2] > 50)
    # Also find bright pale yellow/white pixels in upper-right quadrant for moon
    moon_mask = (arr[:int(h*0.55), int(w*0.5):, 0] > 225) & (arr[:int(h*0.55), int(w*0.5):, 1] > 210) & (arr[:int(h*0.55), int(w*0.5):, 2] > 160)
    if moon_mask.any():
        ys, xs = np.where(moon_mask)
        mx = (xs.mean() + w*0.5) / w
        my = ys.mean() / h
    else:
        mx, my = -1, -1

    # For device: look in lower 75% of image
    dev_mask = warm.copy()
    dev_mask[:int(h*0.35), :] = False
    if dev_mask.any():
        ys, xs = np.where(dev_mask)
        dx = xs.mean() / w
        dy = ys.mean() / h
    else:
        dx, dy = -1, -1
    print(f"{p.split('/')[-1]:28s} | moon=({mx:.3f}, {my:.3f}) | warm_center=({dx:.3f}, {dy:.3f})")
