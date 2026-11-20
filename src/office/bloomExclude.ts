// #663 the roots the office's bloom leaves out (holoBloom.ts): HoloBoard registers its own. Apart from holoBloom so the board needs no
// post-processing import.
import type { Object3D } from 'three'

export const bloomExcluded = new Set<Object3D>()
