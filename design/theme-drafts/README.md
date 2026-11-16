# Theme drafts

Alternative themes drafted for Farescope. **daylight** (in `apps/web/src/themes/`) was chosen.
`midnight` is the original theme.

To preview one again:
1. Copy its `.css` file into `apps/web/src/themes/`.
2. Copy its globe texture into `apps/web/public/` from `node_modules/three-globe/example/img/`. The texture is named by `--globe-texture` near the end of each file: `earth-night.jpg`, `earth-dark.jpg`, `earth-day.jpg` or `earth-blue-marble.jpg`.
3. Run the dev server. With more than one theme present, a theme picker appears, or open `?theme=<name>`.
