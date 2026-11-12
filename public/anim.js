// Lottie animations for Leash, generated in code so they match the theme tokens.
// Rendered with lottie-web (SVG renderer).
(function () {
  const K = (k) => ({ a: 0, k });
  const ease = { i: { x: [0.22], y: [1] }, o: { x: [0.6], y: [0] } };
  const anim = (frames) => ({
    a: 1,
    k: frames.map(([t, v], idx) => (idx < frames.length - 1 ? { t, s: [].concat(v), ...ease } : { t, s: [].concat(v) })),
  });

  function cssColor(name) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const hex = raw.replace("#", "");
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const n = parseInt(full, 16);
    if (Number.isNaN(n)) return [0.2, 0.2, 0.2, 1];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }

  const tr = () => ({ ty: "tr", p: K([0, 0]), a: K([0, 0]), s: K([100, 100]), r: K(0), o: K(100), sk: K(0), sa: K(0) });
  const stroke = (c, w) => ({ ty: "st", c: K(c), o: K(100), w: K(w), lc: 2, lj: 2, ml: 4 });
  // lottie-web mutates shape data in place, so every animation gets its own copy of the points
  // (reusing the shared arrays corrupted the shield after a theme switch redraw).
  const copy = (pts) => pts.map((p) => [...p]);
  const path = (v, i, o, closed) => ({
    ty: "sh",
    ks: K({ v: copy(v), i: i ? copy(i) : v.map(() => [0, 0]), o: o ? copy(o) : v.map(() => [0, 0]), c: !!closed }),
  });
  const ellipse = (d) => ({ ty: "el", p: K([0, 0]), s: K([d, d]), d: 1 });
  const trim = (s, e, o) => ({ ty: "tm", s: s ?? K(0), e: e ?? K(100), o: o ?? K(0), m: 1 });

  function layer(ind, shapes, op, extraKs) {
    return {
      ddd: 0, ind, ty: 4, nm: `l${ind}`, sr: 1,
      ks: { o: K(100), r: K(0), p: K([50, 50, 0]), a: K([0, 0, 0]), s: K([100, 100, 100]), ...extraKs },
      ao: 0, shapes: [{ ty: "gr", it: [...shapes, tr()] }], ip: 0, op, st: 0, bm: 0,
    };
  }
  const doc = (nm, op, layers) => ({ v: "5.7.4", fr: 60, ip: 0, op, w: 100, h: 100, nm, ddd: 0, assets: [], layers });

  // Shield outline (same silhouette as the wordmark)
  const shieldV = [[0, -34], [27, -23], [27, 2], [0, 34], [-27, 2], [-27, -23]];
  const shieldI = [[0, 0], [0, 0], [0, 0], [15, -8], [0, 16], [0, 0]];
  const shieldO = [[0, 0], [0, 0], [0, 16], [-15, -8], [0, 0], [0, 0]];

  // ---- Gate: shield + an orbiting scan arc, looping ----
  function gateData() {
    const op = 180;
    const ink = cssColor("--ink-2");
    const accent = cssColor("--accent");
    const shield = layer(2, [path(shieldV, shieldI, shieldO, true), stroke(ink, 3.2)], op);
    const tick = layer(3, [path([[-11, 1], [-3, 9], [12, -7]]), stroke(accent, 3.6),
      trim(K(0), anim([[0, 0], [40, 100], [150, 100], [178, 0]]))], op);
    const ring = layer(1, [ellipse(92), stroke(accent, 2.4), trim(K(0), K(18), anim([[0, 0], [op, 360]]))], op);
    return doc("gate", op, [tick, shield, ring]);
  }

  // ---- Verdicts: circle draw + mark draw + pop ----
  function verdictData(kind) {
    const op = 70;
    const color = cssColor(kind === "allow" ? "--allow" : kind === "review" ? "--review" : "--block");
    const draw = (from, to) => trim(K(0), anim([[from, 0], [to, 100]]));
    const pop = { s: anim([[0, [60, 60, 100]], [16, [110, 110, 100]], [28, [100, 100, 100]]]) };
    const circle = layer(9, [ellipse(80), stroke(color, 5), draw(0, 26)], op, pop);
    let marks;
    if (kind === "allow") {
      marks = [layer(1, [path([[-17, 2], [-5, 14], [18, -11]]), stroke(color, 6), draw(16, 40)], op, pop)];
    } else if (kind === "block") {
      marks = [
        layer(1, [path([[-14, -14], [14, 14]]), stroke(color, 6), draw(16, 32)], op, pop),
        layer(2, [path([[14, -14], [-14, 14]]), stroke(color, 6), draw(26, 42)], op, pop),
      ];
    } else {
      marks = [
        layer(1, [path([[0, -17], [0, 5]]), stroke(color, 6), draw(16, 34)], op, pop),
        layer(2, [ellipse(1.5), stroke(color, 7), draw(34, 40)], op, { ...pop, p: K([50, 66, 0]) }),
      ];
    }
    return doc(`verdict-${kind}`, op, [...marks, circle]);
  }

  let gate = null;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  window.LeashAnim = {
    mountGate(el) {
      if (!window.lottie || !el) return;
      gate?.destroy();
      gate = window.lottie.loadAnimation({ container: el, renderer: "svg", loop: true, autoplay: !reduced, animationData: gateData() });
      gate.setSpeed(0.6);
    },
    gate(state) {
      if (!gate) return;
      if (state === "check") gate.setSpeed(2.4);
      else if (state === "busy") gate.setSpeed(1.2);
      else gate.setSpeed(0.6);
    },
    verdict(el, kind) {
      if (!el) return;
      el.innerHTML = "";
      if (!window.lottie) return;
      const a = window.lottie.loadAnimation({ container: el, renderer: "svg", loop: false, autoplay: true, animationData: verdictData(kind) });
      if (reduced) a.goToAndStop(69, true);
    },
  };
})();
