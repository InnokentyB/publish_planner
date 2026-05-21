export function mapActionStatus(actionStatus?: string | null) {
    if (actionStatus === 'completed') return 'published';
    if (actionStatus === 'completed_with_negative_outcome') return 'published';
    if (actionStatus === 'skipped') return 'skipped';
    if (actionStatus === 'deferred') return 'deferred';
    return 'planned';
}

export function resolveActionTitle(action: any) {
    return action.display_name || `${action.id} · ${action.action_type}`;
}

export function parseRecurringTrigger(trigger: string, timezone: string, now: Date = new Date()) {
    const currentDay = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone }).toLowerCase();
    const currentHourMinute = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone });

    const dailyMatch = trigger.match(/^daily_(\d{2}:\d{2})_local$/);
    if (dailyMatch) {
        const time = dailyMatch[1];
        return {
            due: currentHourMinute >= time,
            scheduleAt: new Date(now.toISOString().slice(0, 10) + `T${time}:00`)
        };
    }

    const weeklyMatch = trigger.match(/^weekly_([a-z]+)_(\d{2}:\d{2})(?:_.+)?$/i);
    if (weeklyMatch) {
        const day = weeklyMatch[1];
        const time = weeklyMatch[2];
        const [hour, minute] = time.split(':');
        const scheduleAt = new Date(now.toISOString().slice(0, 10) + `T${hour}:${minute}:00`);
        return {
            due: currentDay === day.toLowerCase() && currentHourMinute >= `${hour}:${minute}`,
            scheduleAt
        };
    }

    return null;
}
