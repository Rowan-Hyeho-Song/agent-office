// How a dozing agent looks (#110, designer's spec). Every number the look depends on lives here.

export const DOZE = {
  /** head tilted forward */
  tiltRad: (15 * Math.PI) / 180,
  /** the head hovers this much lower than when working (m) */
  lowerM: 0.06,
  /** breathing: ± this height (m) over this period (s); none with reduced motion */
  bobM: 0.01,
  bobPeriodS: 4,
  /** the face screen's "– –" brightness (0..1) */
  faceBrightness: 0.4,
  /** the hover light beam while dozing, as a share of its normal opacity */
  beamShare: 0.4,
  /** hands rest on the desk beside the keyboard: root-frame x offset (±), z, and height above the desk top (m) */
  hands: { x: 0.22, z: -0.42, aboveDeskM: 0.01 },
  /** the floating "z": one every `everyS`, rising `risePx` over `lifeS`, at most `max` alive, ink at `alpha` */
  z: { everyS: 3, lifeS: 2.4, risePx: 24, max: 2, alpha: 0.6 },
}
