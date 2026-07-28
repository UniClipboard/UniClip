function splitIDs(value) {
  return String(value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function operationIDs(fields) {
  return [
    ...splitIDs(fields?.insertedIDs),
    ...splitIDs(fields?.removedIDs),
    ...splitIDs(fields?.movedIDs),
    ...splitIDs(fields?.reconfiguredIDs),
  ];
}

export function selectLatestKeyboardSession(rawEvents) {
  let latestSessionID;
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  let latestIndex = -1;

  rawEvents.forEach((event, index) => {
    if (!event.sessionID) return;
    const timestamp = Number(event.timestampMs);
    const sortableTimestamp = Number.isFinite(timestamp) ? timestamp : index;
    if (
      sortableTimestamp > latestTimestamp ||
      (sortableTimestamp === latestTimestamp && index > latestIndex)
    ) {
      latestTimestamp = sortableTimestamp;
      latestIndex = index;
      latestSessionID = event.sessionID;
    }
  });

  if (!latestSessionID) return rawEvents;
  return rawEvents.filter(({ sessionID }) => sessionID === latestSessionID);
}

export function analyzeKeyboardEvents(rawEvents) {
  const numberedEvents = rawEvents.map((event, index) => ({
    ...event,
    line: event.line ?? index + 1,
  }));

  const eventsBySession = new Map();
  for (const event of numberedEvents) {
    const sessionID = event.sessionID ?? '__legacy__';
    const events = eventsBySession.get(sessionID) ?? [];
    events.push(event);
    eventsBySession.set(sessionID, events);
  }

  return [...eventsBySession.values()]
    .flatMap(analyzeKeyboardSession)
    .sort((left, right) => left.line - right.line);
}

function analyzeKeyboardSession(events) {
  const failures = [];

  const layoutsByController = new Map();
  for (const event of events) {
    if (event.event !== 'controller.layout' || !event.fields?.controllerID) continue;
    const layouts = layoutsByController.get(event.fields.controllerID) ?? [];
    layouts.push({
      height: Number(event.fields.height),
      surfaceHeight: Number(event.fields.surfaceHeight),
      line: event.line,
    });
    layoutsByController.set(event.fields.controllerID, layouts);
  }

  for (const [controllerID, layouts] of layoutsByController) {
    const oversized = layouts.find(
      ({ height, surfaceHeight }) => height > 500 && (!surfaceHeight || surfaceHeight > 500)
    );
    const keyboardSized = layouts.find(({ height }) => height > 0 && height <= 400);
    if (oversized && keyboardSized && oversized.line < keyboardSized.line) {
      failures.push({
        kind: 'full-height-jump',
        line: oversized.line,
        message:
          `controller ${controllerID} laid out at ${oversized.height} (line ${oversized.line}) ` +
          `before ${keyboardSized.height} (line ${keyboardSized.line})`,
      });
    }
  }

  const plansByID = new Map();
  for (const event of events) {
    if (event.event === 'view.card.update.plan') {
      const reason = event.fields?.reason;
      const affectedIDs = new Set(splitIDs(event.fields?.affectedIDs));
      const reconfiguredIDs = splitIDs(event.fields?.reconfiguredIDs);
      const operations = operationIDs(event.fields);
      const updateID = event.fields?.updateID;
      const plan = { reason, affectedIDs };
      if (updateID) plansByID.set(updateID, plan);

      if ((reason === 'syncButton' || reason === 'error') && operations.length > 0) {
        failures.push({
          kind: 'unexpected-card-operation',
          line: event.line,
          message: `${reason} created card operations for ${operations.join(',')}`,
        });
      }

      if (reason === 'cardAction' && affectedIDs.size > 0) {
        const unrelatedIDs = reconfiguredIDs.filter((id) => !affectedIDs.has(id));
        if (unrelatedIDs.length > 0) {
          failures.push({
            kind: 'unrelated-card-reconfiguration',
            line: event.line,
            message: `card action requested unrelated cards ${unrelatedIDs.join(',')}`,
          });
        }
      }
      continue;
    }

    if (event.event !== 'view.card.configure') continue;
    const plan = plansByID.get(event.fields?.updateID);
    const cardID = event.fields?.cardID;
    if ((plan?.reason === 'syncButton' || plan?.reason === 'error') && cardID) {
      failures.push({
        kind: 'unexpected-card-configuration',
        line: event.line,
        message: `${plan.reason} actually configured card ${cardID}`,
      });
      continue;
    }
    if (
      plan?.reason === 'cardAction' &&
      plan.affectedIDs.size > 0 &&
      cardID &&
      !plan.affectedIDs.has(cardID)
    ) {
      failures.push({
        kind: 'unrelated-card-configuration',
        line: event.line,
        message: `card action actually configured unrelated card ${cardID}`,
      });
    }
  }

  return failures;
}
