// Skill: context retrieval + the meeting-overrun record (R01, R02).
// Pure functions deriving the conflict and the action floor from the day state.

// The floor is the earliest an action can start after the reported overrun.
export function actionFloor(day) {
  return day.meeting ? day.meeting.end : 0;
}

// The day used for feasibility: the overrun meeting becomes a protected block so
// the planned action's transition buffer is enforced against the meeting end too
// (PRD example: a 10-min buffer after a 6:20 meeting pushes the earliest start).
export function planningDay(day) {
  if (!day.meeting) return day;
  const meetingBlock = {
    id: 'meeting-block',
    title: day.meeting.title,
    start: day.meeting.start,
    end: day.meeting.end,
    protected: true,
  };
  return { ...day, commitments: [...day.commitments, meetingBlock] };
}

// Does the revised meeting actually conflict with the currently-planned action?
// An unchanged / earlier-ending meeting that causes no conflict forces nothing.
export function conflictWithPlanned(day) {
  if (!day.meeting) return { conflict: false };
  const p = day.planned;
  const meetingEnd = day.meeting.end;
  const bufferedStart = p.start - p.bufferBeforeMin;
  // Conflict if the meeting (or its presence past the planned start) eats the
  // planned window or its leading buffer.
  if (meetingEnd > bufferedStart) {
    return {
      conflict: true,
      affectedId: p.id,
      reason: meetingEnd > p.start ? 'overrun-into-action' : 'overrun-into-buffer',
    };
  }
  return { conflict: false, affectedId: p.id };
}

export function recordMeeting(day, { title, start, end }) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
    return { ok: false, reason: 'invalid-time', day };
  }
  const next = {
    ...day,
    meeting: { title: (title || 'Meeting').trim(), start, end },
  };
  return { ok: true, day: next };
}
