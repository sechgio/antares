import { streamUrl, type AudiusTrack } from './core';
import { createStreamPlayer, type StreamPlayer } from '../streaming/player';

export interface AudiusPlayer extends StreamPlayer<AudiusTrack> {}

export function createAudiusPlayer(): AudiusPlayer {
  return createStreamPlayer('audius', streamUrl);
}
