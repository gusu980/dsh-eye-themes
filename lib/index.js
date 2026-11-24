/**
 * Host half of dsh-eye-themes.
 *
 * Every palette lives in the client half: it stacks one alias-token override
 * layer for the selected palette and contributes the switcher row to
 * Settings -> General. This half has no work to do — but its Loader row has to
 * exist, because `dsh-client-modules` discovers `dsh.client` by walking the
 * enabled rows' manifests, so without a mounted row the browser bundle is never
 * served.
 *
 * Deliberately declares no `inject`: a host service dependency here would leave
 * the row permanently pending in profiles that do not compose that service, and
 * the row only needs to be mounted, not activated.
 */

/** Stable plugin name; matches the row id in cordis.patch.yml. */
export const name = 'dsh-eye-themes'

/** No host-side setup: the palettes live in the client bundle. */
export function apply() {}
