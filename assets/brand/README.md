# Turncoat brand files

The mark is the eye in `../logo.svg`: a half-closed eye with a keyhole for a pupil. Everything here is exported from that file.

## Colours

| Name | Hex | Use |
|---|---|---|
| Near-black | `#0C0C10` | Backgrounds, the avatar square, wordmark on light backgrounds |
| Bone | `#F3EFE6` | Text and wordmark on dark backgrounds, the white of the eye |
| Signal orange-red | `#FF4A26` | The iris, and one accent at most per layout |

No yellow anywhere, so nothing is mistaken for Binance branding.

## Which file to use where

| File | Size | Use it for |
|---|---|---|
| `avatar-400.png` | 400×400 | X profile picture, small icons |
| `avatar-1024.png` | 1024×1024 | Submission forms, app icons, anywhere that asks for a large square logo |
| `mark-transparent.svg` | vector | The eye alone on a **dark** background. Its white and outline disappear on light backgrounds; use the avatar there. |
| `lockup-dark.svg` | vector | Mark and TURNCOAT wordmark on a **dark** background (headers, slides, the site) |
| `lockup-light.svg` | vector | Mark (on its dark square) and wordmark on a **light** background (documents, forms) |
| `banner-1500x500.png` | 1500×500 | X header image. The content sits right of centre so the profile picture does not cover it. |

The avatars have transparent rounded corners, exactly as in the SVG. The wordmark in both lockups is Archivo at weight 900 (the site's heading font) with 0.06em letter-spacing, converted to outlines, so the files need no font installed.
