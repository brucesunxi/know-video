# Local Motion Engine

Know Video uses a deterministic image-motion path before asking users to pay for a generative video model.

## Design basis

The pipeline follows the cost-efficient composition pattern demonstrated by MoneyPrinterTurbo (MIT): search free or local video material from script-level English terms, split source material into bounded clips, fit each clip to the target frame, apply deterministic transitions, and then compose narration, captions, and music. The implementation is native to the existing TypeScript and Remotion renderer rather than embedding MoneyPrinterTurbo's Python and MoviePy runtime.

Two zero-paid-model motion methods are exposed:

- Simple camera motion keeps the generated scene image and applies deterministic pan, zoom, drift, and transitions.
- Dynamic stock editing searches Pexels or Pixabay, imports a relevant real video clip into R2, selects a deterministic usable segment, and lets Remotion cut it to the narration-aligned scene duration. A missing provider or unmatched query falls back to simple camera motion and never invokes paid image-to-video generation.

Configure at least one free provider key with `PEXELS_API_KEY` or `PIXABAY_API_KEY`. Search terms are produced during the existing storyboard request, so stock matching does not add a separate language-model call.

Reference: https://github.com/harry0703/MoneyPrinterTurbo

## Runtime behavior

- The generated scene image remains the visual source of truth.
- Each scene is divided into one to four virtual material clips according to narration-aligned scene duration.
- The virtual clips reinterpret the source image as wide, medium, and detail shots instead of moving one crop for the whole scene.
- `motionPrompt` selects the opening push-in, pull-out, pan, tilt, or gentle drift; complementary shot directions are selected for later clips.
- Clip boundaries use deterministic dissolve, slide, or zoom transitions inspired by MoneyPrinterTurbo's transition stage.
- Scene duration and intensity determine clip count, transition timing, and movement amplitude. The sequence always covers the complete scene duration.
- A stored seed keeps preview and MP4 export identical; reapplying automatic motion advances the seed to produce another suitable plan.
- Existing generated video clips play only when the scene explicitly uses AI motion.
- Local motion has no generative-video provider charge. AI motion remains an explicit paid enhancement for real subject movement.

## Product rule

The motion dialog defaults to local smart motion. Pricing is shown only for AI motion choices, and an AI request is never made without an explicit paid selection.
