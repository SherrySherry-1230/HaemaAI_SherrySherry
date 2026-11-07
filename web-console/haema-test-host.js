// @editedBy YAONG1230
(function () {
    'use strict';

    const choices = new Map([
        ['', '해마.ai만 사용'],
        ['friend', '친구친구이야기해,마'],
        ['schedule', '일정기억해,마'],
        ['mindfulness', '마음챙김해,마'],
        ['diet', '다이어트해,마'],
        ['creative', '창작해,마'],
        ['pet', '해마해,마']
    ]);

    function bind(select, onChange) {
        const selected = select.value;
        const options = Array.from(choices, ([value, label]) => new Option(label, value));
        select.replaceChildren(...options);
        select.value = choices.has(selected) ? selected : '';
        select.onchange = () => onChange(select.value);
    }

    window.HaemaHostPicker = { bind };
})();
