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
        const scale = ceiling(Math.max(latest?.totalKnown || 0, total?.totalKnown || 0));
        const variant = ((summary?.turnCount || 1) - 1) % 4 + 1;
        const row = (label, item, cumulative = false) => {
            const hasValue = known(item?.totalKnown);
            const value = failed ? '확인 필요' : valueText(item, loading && !cumulative);
            const width = hasValue ? Math.min(100, item.totalKnown / scale * 100) : 0;
            return '<div class="token-meter-row"><span class="token-meter-label">' + label + '</span>' +
                '<span class="token-meter-track token-shape-' + (cumulative ? variant % 4 + 1 : variant) + '" aria-hidden="true">' +
                (hasValue ? '<span class="token-meter-fill' + (cumulative ? ' is-cumulative' : '') + '" style="width:' + width + '%"></span>' : '<span class="token-meter-unavailable"></span>') +
                '</span><strong class="token-meter-value" aria-label="' + escape(label + ' ' + value + (hasValue ? ' 토큰' : '')) + '">' + escape(value) + '</strong></div>';
        };
        let note = failed ? '사용량 기록을 확인하지 못했어요. 기존 기록은 보존돼요.' :
            !hasTurns ? '대화를 보내면 발화별 사용량을 확인할 수 있어요.' :
            summary.complete ? summary.turnCount + '개 발화 · 두 막대는 같은 눈금이에요.' :
            known(summary.totalKnown) ? '≥는 확인된 사용량이에요. 미집계 발화가 있어요.' :
            loading ? '실제 사용량이 도착하면 표시해요.' : '사용량 정보가 아직 전달되지 않았어요.';
        const detail = latest && (known(latest.inputKnown) || known(latest.outputKnown))
            ? '이번 입력 ' + (known(latest.inputKnown) ? (latest.inputComplete ? '' : '≥ ') + format(latest.inputKnown) : '미제공') + ' · 출력 ' + (known(latest.outputKnown) ? (latest.outputComplete ? '' : '≥ ') + format(latest.outputKnown) : '미제공') : '';
        const explanation = 'AI가 보고한 토큰 사용량입니다. 모델마다 토큰 분할 방식이 달라 동일 문장도 수치가 다를 수 있어요. 누적에는 이 대화의 확인된 호출만 포함되며 비용이나 절감률을 뜻하지 않아요.';
        return '<section class="token-meter" aria-label="대화 토큰 사용량"><div class="token-meter-heading"><span>토큰 사용량</span><span class="token-meter-unit" tabindex="0" title="' + explanation + '">tokens ⓘ</span></div>' +
            row('이번 발화', latest) + row('대화 누적', total, true) +
            '<p class="token-meter-note" title="' + escape(detail || note) + '">' + escape(detail || note) + '</p>' +
            (detail && !summary.complete ? '<p class="token-meter-note">' + escape(note) + '</p>' : '') + '</section>';
    }
    function badge(turn) {
        return '<span class="result-token-usage">토큰 ' + escape(turn?.ok === false ? '확인 필요' : !turn || turn.found === false ? '미제공' : valueText(turn)) + '</span>';
    }
    global.HAEMA_TOKEN_METER = { render, badge, ceiling, valueText };
})(window);
