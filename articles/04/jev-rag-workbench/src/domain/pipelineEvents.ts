/**
 * Pipeline Event types for real-time visualization
 */

import { PipelineStageRecord } from './models';

export type PipelineEventCallback = (event: PipelineEvent) => void;

export interface PipelineEvent {
  type: 'stage_start' | 'stage_complete' | 'pipeline_complete' | 'error';
  stageId?: string;
  record?: PipelineStageRecord;
  data?: any;
}
