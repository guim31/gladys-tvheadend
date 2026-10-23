// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// `record_now`: record a channel (its name or number, as Tvheadend shows it)
// from now, for N minutes — "it is 20:55 and nobody is home: record the
// news". `get_recordings`: what records, what comes next and the free space,
// with a ready-made sentence for a message or a spoken announcement; the
// figures alone are already device features.
// -----------------------------------------------------------------------------

import { formatWhen } from './texts.js';

export const SCENE_ACTIONS = {
  async record_now(hub, { fields = {} }) {
    return hub.recordNow({
      channel: fields.channel,
      duration: fields.duration,
      title: fields.title,
    });
  },

  async get_recordings(hub) {
    const view = await hub.freshView();
    const language = hub.config.language;
    const next = view.scheduled[0] ?? null;
    return {
      recording_count: view.recording.length,
      scheduled_count: view.scheduled.length,
      current: view.recording.map((e) => e.title || e.channel).join(', '),
      next_title: next?.title ?? '',
      next_channel: next?.channel ?? '',
      next_time: next?.start ? formatWhen(next.start, language, hub.now()) : '',
      free_gb: view.disk?.freeGb ?? 0,
      free_percent: view.disk?.freePercent ?? 0,
      sentence: hub.sentence(view, language),
    };
  },
};
