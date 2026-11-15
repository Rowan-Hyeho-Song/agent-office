// #137 ② ③ the visitor at a game (the omok board, the ping-pong paddle): the camera rig, the WASD keys, the tour and the scene's other picks stand aside
import { isOmokActive } from './omokVisit/store'
import { isPingpongActive } from './pingpongVisit/store'

export const isVisitPlaying = () => isOmokActive() || isPingpongActive()
