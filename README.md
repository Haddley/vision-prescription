# Vision Prescription

A WebXR prism-prescription finder — the sister app to
[Vision Home](https://haddley.github.io/vision-home/).

Vision Home *simulates* a prism prescription during Brock-string home training. This app
*estimates* that prescription, the way an eye doctor does: you look at a letter **H** and the
voice asks, in effect, *"better with one… or two?"* while alternating two candidate prism
settings. Squeeze the trigger (or pinch) while the better-looking view is showing; a bracketing
staircase converges to quarter-diopter precision, horizontal then vertical. Your head must stay
level — a bubble indicator turns red and the exam pauses if you tilt.

The suggested prescription uses the same convention as Vision Home's prism fields, so a
positive result can be typed straight into its start page. **It is a screening estimate, not a
diagnosis — share it with your eye-care professional first.**

Static site: no build step, no dependencies. Serve the folder and open it in a headset browser
(Meta Quest Browser, or Safari on Apple Vision Pro):

```
python3 -m http.server
```

All data stays in the browser's `localStorage`; the JSON download is the only way it leaves.
