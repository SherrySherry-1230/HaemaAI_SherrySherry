// @editedBy YAONG1230 2026-10-16
// Display only observed usage. No text-length estimates or provider API assumptions.
(function (global) {
    'use strict';
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
    const format = value => new Intl.NumberFormat('ko-KR').format(value);
    const known = value => Number.isSafeInteger(value) && value >= 0;
    function valueText(item, loading = false) {
        if (!item) return '대화 대기';
        if (!known(item.totalKnown)) return loading ? '집계 중' : item.status === 'pending' ? '확인 필요' : '미제공';
        return (item.complete ? '' : '≥ ') + format(item.totalKnown);
    }
    function ceiling(value) {
        if (!known(value) || value === 0) return 100;
        const step = Math.pow(10, Math.floor(Math.log10(value)));
        return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(value / step) * step);
    }
    function render(summary, loading = false) {
        const failed = !summary || summary.ok === false;
        const latest = failed ? null : summary.latest;
        const hasTurns = !failed && summary.turnCount > 0;
        const total = hasTurns ? summary : null;
        const quantity = (item, delta = false) => {
            if (failed) return '확인 필요';
            if (!known(item?.totalKnown)) return valueText(item, loading && delta);
            return (delta ? '+' : '') + format(item.totalKnown) + (item.complete ? '' : ' 이상');
        };
        const delta = quantity(latest, true), cumulative = quantity(total);
        const longValue = (delta + cumulative).length > 28;
        // Only split calls whose total is known. Unreported input/output portions
        // stay neutral instead of being guessed or added to a different total.
        const buckets = [false, true].flatMap(current => ['input', 'output', 'other'].map(kind => ({ current, kind, tokens: 0 })));
        for (const turn of failed ? [] : summary.turns || []) {
            const current = turn.utteranceId === latest?.utteranceId;
            for (const call of turn.calls || []) {
                if (!known(call.totalTokens)) continue;
                const input = known(call.inputTokens) ? call.inputTokens : 0;
                const output = known(call.outputTokens) ? call.outputTokens : 0;
                const values = { input, output, other: call.totalTokens - input - output };
                for (const kind of ['input', 'output', 'other']) buckets.find(bucket => bucket.current === current && bucket.kind === kind).tokens += values[kind];
            }
        }
        const segments = buckets.filter(bucket => bucket.tokens > 0);
        const labels = { input: '입력', output: '출력', other: '미분류' };
        const segmentLabel = segment => (segment.current ? '이번 발화 ' : '이전 발화 ') + labels[segment.kind] + ' ' + format(segment.tokens) + ' 토큰';
        const firstCurrent = segments.find(segment => segment.current);
        const hasValue = known(total?.totalKnown);
        const bar = hasValue ? segments.map(segment => '<span class="token-meter-segment token-kind-' + segment.kind +
            (segment.current ? ' is-current' : '') + (segment === firstCurrent ? ' is-new-start' : '') + '" style="width:' + (segment.tokens / (total.totalKnown || 1) * 100) +
            '%" title="' + escape(segmentLabel(segment)) + '"></span>').join('') : '<span class="token-meter-unavailable"></span>';
        const note = failed ? '사용량 기록을 확인하지 못했어요. 기존 기록은 보존돼요.' :
            !hasTurns ? '대화를 보내면 발화별 사용량을 확인할 수 있어요.' :
            summary.complete ? '' : known(summary.totalKnown) ? '확인된 사용량만 표시해요. 미집계 발화가 있어요.' :
            loading ? '실제 사용량이 도착하면 표시해요.' : '사용량 정보가 아직 전달되지 않았어요.';
        const component = kind => '<span class="token-meter-key token-key-' + kind + '">' + labels[kind] + '</span>';
        const legend = component('input') + component('output') +
            (segments.some(segment => segment.kind === 'other') ? '<span class="token-meter-key token-key-other">미분류</span>' : '') + '<span class="token-meter-current-key">진한색 · 이번 발화</span>';
        const explanation = 'AI가 보고한 토큰 사용량입니다. 모델마다 토큰 분할 방식이 달라 동일 문장도 수치가 다를 수 있어요. 누적에는 이 대화의 확인된 호출만 포함되며 비용이나 절감률을 뜻하지 않아요.';
        return '<section class="token-meter" aria-label="대화 토큰 사용량"><div class="token-meter-heading token-meter-summary"><span class="token-meter-label">대화 누적 <span class="token-meter-unit" tabindex="0" title="' + explanation + '">tokens ⓘ</span></span>' +
            '<strong class="token-meter-value' + (longValue ? ' is-long' : '') + '" aria-label="' + escape('이번 발화 ' + delta + ' 토큰, 대화 누적 ' + cumulative + ' 토큰') + '"><span class="token-meter-delta">' + escape(delta) + '</span><span class="token-meter-total"><span class="token-meter-divider"> / </span>' + escape(cumulative) + '</span></strong></div>' +
            '<div class="token-meter-track token-shape-1" role="img" aria-label="' + escape('대화 누적 ' + cumulative + ' 토큰. ' + segments.map(segmentLabel).join(', ')) + '"><div class="token-meter-liquid" data-token-total="' + (hasValue ? total.totalKnown : '') + '" data-token-conversation="' + escape(summary?.conversationId || '') + '">' + bar + '</div><span class="token-meter-glass" aria-hidden="true"></span></div>' +
            '<div class="token-meter-legend">' + legend + '</div>' + (note ? '<p class="token-meter-note">' + escape(note) + '</p>' : '') + '</section>';
    }
    // Keep animation progress outside the replaced DOM. Re-rendering an input or
    // a card resumes the same fill instead of restarting it or counting again.
    const fills = new Map();
    function animate(root, scopeKey = '') {
        const liquid = root?.querySelector?.('.token-meter-liquid');
        if (!liquid || liquid.dataset.tokenTotal === '') return;
        const total = Number(liquid.dataset.tokenTotal);
        if (!known(total)) return;
        const key = JSON.stringify([scopeKey, liquid.dataset.tokenConversation]);
        const time = global.performance?.now?.() ?? Date.now();
        let state = fills.get(key);
        if (!state || state.total !== total) {
            const previousTotal = state?.total || 0;
            const previousProgress = state ? state.from + (1 - state.from) * Math.min(1, Math.max(0, time - state.startedAt) / state.duration) : 0;
            state = { total, from: total > previousTotal ? previousTotal * previousProgress / total : 1, startedAt: time, duration: 720 };
            fills.set(key, state);
            if (fills.size > 32) fills.delete(fills.keys().next().value);
        }
        if (global.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof liquid.animate !== 'function') {
            state.from = 1;
            return;
        }
        const elapsed = Math.max(0, time - state.startedAt);
        if (state.from >= 1 || elapsed >= state.duration) return;
        const progress = state.from + (1 - state.from) * elapsed / state.duration;
        liquid.animate([{ clipPath: 'inset(0 ' + ((1 - progress) * 100) + '% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }],
            { duration: state.duration - elapsed, easing: 'linear' });
    }
    function badge(turn) {
        return '<span class="result-token-usage">토큰 ' + escape(turn?.ok === false ? '확인 필요' : !turn || turn.found === false ? '미제공' : valueText(turn)) + '</span>';
    }
    global.HAEMA_TOKEN_METER = { render, badge, ceiling, valueText, animate };
})(window);
