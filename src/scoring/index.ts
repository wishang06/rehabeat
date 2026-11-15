export {
  GOOD_SCORE,
  PERFECT_SCORE,
  UNSEEN_JOINT_TOLERANCES,
  jointReading,
  labelFor,
  meanAngleError,
  scoreFrame,
  scoreFromError,
  unseenJointError,
  zeroScoreError,
} from './frameScore';
export { Routine, type Cycle, type Phase, type PhaseInfo } from './routine';
export {
  LOCK_ENTER_SCORE,
  LOCK_ENTER_SEC,
  LOCK_EXIT_SCORE,
  LOCK_EXIT_SEC,
  PoseLock,
  type ScoredSample,
} from './poseLock';
export {
  FORM_PERSIST_MS,
  FORM_RULES,
  FormMonitor,
  SHRUG_DROP_FRACTION,
  TRUNK_LEAN_LIMIT_DEG,
  formNoteFor,
  type FormContext,
} from './formRules';
export {
  LIMIT_MARGIN_DEG,
  LIMIT_PERSIST_MS,
  LimitWatcher,
  angleForMovement,
  movementOf,
  type JointLimit,
  type JointLimits,
} from './limits';
export { applyResult, initialStats, type Stats } from './stats';
export type { HoldDetail, JointHold } from './holdDetail';
export {
  HOLD_BEST_SHARE,
  MAX_FRAME_SPAN_SEC,
  ScoringEngine,
  type LiveState,
  type ScoringEngineOptions,
} from './scoringEngine';
export {
  DEFAULT_CALIBRATION,
  ShrugBaselineCollector,
  loadCalibration,
  saveCalibration,
  type Calibration,
} from './calibrationStore';
export {
  MAX_POINTS_PER_MOVE,
  pointsFor,
  summarizeRun,
  type RunSummary,
} from './points';
