// @editedBy YAONG1230 2026-11-09
(() => {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const curveWidth = 27.2448;
    const sourceWidth = 42.57;
    const sourceHeight = 153.23;
    const topHeight = 54.85;
    const bottomHeight = 70.1;
    const colors = ['#E4DDEE', '#CDC4D8', '#BBB4C4', '#AAA1B4', '#90869C', '#71677D', '#564E61'];
    const styles = Object.freeze(Object.fromEntries(colors.map((color, index) => [
        index + 1,
        Object.freeze({ color, width: index + 1 })
    ])));
    const unknownStyle = Object.freeze({ color: '#9B979F', width: 2 });
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    const coordinate = value => String(Number(value.toFixed(6)));

    function pathFor(geometry) {
        if (!geometry || typeof geometry !== 'object') return null;
        const { startX, startY, endX, endY, lane } = geometry;
        if (![startX, startY, endX, endY, lane].every(finite) || lane <= 0) return null;
        const [topX, topY, bottomX, bottomY] = startY <= endY
            ? [startX, startY, endX, endY]
            : [endX, endY, startX, startY];
        if (Math.abs(topX - bottomX) > 0.001) return null;
        const scale = lane / sourceWidth;
        if (bottomY - topY + 0.000001 < (topHeight + bottomHeight) * scale) return null;

        const spineX = topX + lane;
        // Size both complete ends uniformly, including their short horizontal tips.
        // At that size only the straight central section changes length.
        const values = [
            topX, topY,
            topX + 6 * scale,
            topX + 37.48 * scale, topY, spineX, topY + 19.12 * scale, spineX, topY + topHeight * scale,
            bottomY - bottomHeight * scale,
            spineX, bottomY - 15.34 * scale, topX + 27.86 * scale, bottomY, topX + 9.57 * scale, bottomY,
            bottomX
        ];
        if (!values.every(finite)) return null;
        const p = values.map(coordinate);
        return `M${p[0]} ${p[1]} H${p[2]} C${p.slice(3, 9).join(' ')} V${p[9]} C${p.slice(10, 16).join(' ')} H${p[16]}`;
    }

    function paint(pathElement, geometry, level) {
        if (!pathElement || pathElement.namespaceURI !== SVG_NS || pathElement.localName !== 'path') return null;
        const path = pathFor(geometry);
        if (path === null) {
            pathElement.removeAttribute('d');
            return null;
        }

        const known = Number.isInteger(level) && level >= 1 && level <= 7;
        const appearance = known ? styles[level] : unknownStyle;
        const label = known ? `연결 강도 ${level}단계` : '연결 강도 확인 전';
        pathElement.setAttribute('d', path);
        pathElement.setAttribute('vector-effect', 'non-scaling-stroke');
        pathElement.setAttribute('aria-label', label);
        const properties = {
            fill: 'none',
            stroke: appearance.color,
            'stroke-width': String(appearance.width),
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            'stroke-dasharray': known ? 'none' : '4 5',
            'stroke-dashoffset': '0',
            'stroke-opacity': '1',
            opacity: '1',
            'vector-effect': 'non-scaling-stroke'
        };
        for (const [property, value] of Object.entries(properties)) pathElement.style.setProperty(property, value);
        let title = Array.from(pathElement.children).find(child => child.namespaceURI === SVG_NS && child.localName === 'title');
        if (!title) {
            title = pathElement.ownerDocument.createElementNS(SVG_NS, 'title');
            pathElement.append(title);
        }
        title.textContent = label;
        return path;
    }

    window.HaemaSeon = Object.freeze({ pathFor, paint, styles, curveWidth, sourceWidth, sourceHeight });
})();
