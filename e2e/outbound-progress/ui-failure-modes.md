# Nonvisual UI flow failure modes

- A default check can pass true before a user confirms. Assert the recorded native arguments.
- A confirmation can be shown for Running, Superseded, Busy or Unreachable. Assert it is absent.
- A confirmation can hide the duplicate-file warning. Assert the warning before the final press.
- A failed action can leave an old confirmation active. Clear it and require another check.
- Unknown bytes can render as zero. Assert the translated unknown value.
- A classification can replace a complete current view. Render item facts independently.

Use an actual React component tree and actual session stores with controlled native/module boundaries.
This host does not validate native layout, hit testing, UIKit, Compose, or device interaction.
