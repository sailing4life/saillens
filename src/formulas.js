'use strict';
/* A small expression language. No JavaScript evaluation, property access or user code. */
(() => {
  const functions = {
    abs: [1, Math.abs], sqrt: [1, Math.sqrt], min: [2, Math.min], max: [2, Math.max],
    clamp: [3, (x, a, b) => Math.max(a, Math.min(b, x))],
    sinD: [1, x => Math.sin(x * SL.D2R)], cosD: [1, x => Math.cos(x * SL.D2R)],
    tanD: [1, x => Math.tan(x * SL.D2R)], atan2D: [2, (y, x) => Math.atan2(y, x) * SL.R2D],
    wrap180: [1, SL.w180], wrap360: [1, SL.w360], angleDiff: [2, (a, b) => SL.w180(a - b)],
    coalesce: [2, (a, b) => Number.isFinite(a) ? a : b], if: [3, (a, b, c) => Number.isFinite(a) ? (a ? b : c) : NaN]
  };
  function expression(source) {
    if (typeof source !== 'string' || source.length > 2000) throw new Error('Formula must contain at most 2000 characters.');
    const tokens = []; let i = 0;
    while (i < source.length) {
      if (/\s/.test(source[i])) { i++; continue; }
      const s = source.slice(i), m = s.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i) || s.match(/^[A-Za-z_][A-Za-z_0-9]*/) || s.match(/^\[[^\]\r\n]+\]/) || s.match(/^(?:>=|<=|==|!=|&&|\|\||[+\-*/^(),.<>!])/);
      if (!m) throw new Error('Unexpected character at position ' + (i + 1));
      tokens.push(m[0]); i += m[0].length;
      if (tokens.length > 400) throw new Error('Formula is too complex.');
    }
    let p = 0; const refs = new Set(), peek = () => tokens[p], pop = () => tokens[p++];
    const expect = t => { if (pop() !== t) throw new Error('Expected ' + t); };
    const prec = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '^': 7 };
    function parse(min = 0, depth = 0) {
      if (depth > 40) throw new Error('Formula is nested too deeply.');
      let a, t = pop();
      if (t === '+' || t === '-' || t === '!') a = { op: 'unary', sign: t, a: parse(7, depth + 1) };
      else if (t === '(') { a = parse(0, depth + 1); expect(')'); }
      else if (t && /^(\d|\.\d)/.test(t)) a = { op: 'number', value: +t };
      else if (t && (/^[A-Za-z_]/.test(t) || t[0] === '[')) {
        if (peek() === '(') {
          if (!Object.hasOwn(functions, t)) throw new Error('Unknown function: ' + t);
          pop(); const args = [];
          if (peek() !== ')') { do { args.push(parse(0, depth + 1)); if (peek() !== ',') break; pop(); } while (true); }
          expect(')'); if (args.length !== functions[t][0]) throw new Error(t + ' expects ' + functions[t][0] + ' arguments.');
          a = { op: 'call', name: t, args };
        } else {
          let raw = false;
          if (t === 'raw' && (peek() === '.' || peek()?.startsWith('['))) { raw = true; if (peek() === '.') pop(); t = pop(); }
          if (!t || !(/^[A-Za-z_][A-Za-z_0-9]*$/.test(t) || /^\[[^\]]+\]$/.test(t))) throw new Error('Expected channel name.');
          const key = t[0] === '[' ? t.slice(1, -1) : t;
          if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Reserved name.');
          a = { op: 'ref', key, raw }; refs.add((raw ? 'raw.' : '') + key);
        }
      } else throw new Error('Expected a value or channel.');
      while (Object.hasOwn(prec, peek()) && prec[peek()] >= min) { const op = pop(); a = { op, a, b: parse(prec[op] + (op === '^' ? 0 : 1), depth + 1) }; }
      return a;
    }
    const ast = parse(); if (p !== tokens.length) throw new Error('Unexpected token: ' + peek());
    function value(a, ch, raw, i) {
      if (a.op === 'number') return a.value;
      if (a.op === 'ref') return (a.raw ? raw : ch)[a.key]?.[i] ?? NaN;
      if (a.op === 'call') {
        const args = a.args.map(x => value(x, ch, raw, i));
        if (!['if', 'coalesce'].includes(a.name) && args.some(x => !Number.isFinite(x))) return NaN;
        return functions[a.name][1](...args);
      }
      const x = value(a.a, ch, raw, i); if (!Number.isFinite(x)) return NaN;
      if (a.op === 'unary') return a.sign === '-' ? -x : a.sign === '!' ? +!x : x;
      const y = value(a.b, ch, raw, i); if (!Number.isFinite(y)) return NaN;
      switch (a.op) {
        case '+': return x + y; case '-': return x - y; case '*': return x * y; case '/': return y === 0 ? NaN : x / y; case '^': return x ** y;
        case '>': return +(x > y); case '<': return +(x < y); case '>=': return +(x >= y); case '<=': return +(x <= y); case '==': return +(x === y); case '!=': return +(x !== y); case '&&': return +(x && y ? 1 : 0); case '||': return +(x || y ? 1 : 0);
      }
      return NaN;
    }
    return { refs: [...refs], run: (ch, raw, i) => { const v = value(ast, ch, raw, i); return Number.isFinite(v) ? v : NaN; } };
  }
  function compileFormulas(defs, reserved = []) {
    if (!Array.isArray(defs) || defs.length > 100) throw new Error('At most 100 calculated variables per boat.');
    const compiled = new Map(), reservedSet = new Set(reserved);
    for (const d of defs) {
      if (!/^[A-Za-z_][A-Za-z_0-9]{0,47}$/.test(d.name || '') || ['raw', '__proto__', 'constructor', 'prototype'].includes(d.name) || Object.hasOwn(functions, d.name)) throw new Error('Use a unique variable name with letters, numbers and underscores.');
      if (compiled.has(d.name) || reservedSet.has(d.name)) throw new Error('Channel already exists: ' + d.name);
      if (!['number', 'angle', 'boolean'].includes(d.type || 'number')) throw new Error('Unknown variable type.');
      if (d.type === 'angle' && d.unit !== 'deg') throw new Error('Angle variables use deg.');
      if (d.type === 'boolean' && d.unit && d.unit !== '1') throw new Error('Boolean variables have no unit (1).');
      compiled.set(d.name, { ...d, ...expression(d.expression) });
    }
    const order = [], visiting = new Set(), done = new Set();
    function visit(k) { if (done.has(k)) return; if (visiting.has(k)) throw new Error('Circular formula dependency: ' + k); visiting.add(k); const d = compiled.get(k); d.refs.filter(x => compiled.has(x)).forEach(visit); visiting.delete(k); done.add(k); order.push(d); }
    for (const k of compiled.keys()) visit(k); return order;
  }
  function evaluateFormulas(ch, raw, defs, n) {
    const order = compileFormulas(defs, Object.keys(ch)), diagnostics = [];
    for (const d of order) {
      const a = new Float64Array(n).fill(NaN), missing = d.refs.filter(k => k.startsWith('raw.') ? !Object.hasOwn(raw, k.slice(4)) : !Object.hasOwn(ch, k));
      let valid = 0;
      for (let i = 0; i < n; i++) { const v = d.run(ch, raw, i); a[i] = d.type === 'boolean' && Number.isFinite(v) ? +!!v : v; if (Number.isFinite(a[i])) valid++; }
      ch[d.name] = a; diagnostics.push({ name: d.name, unit: d.unit || '', type: d.type || 'number', missing, valid, invalid: n - valid });
    }
    return diagnostics;
  }
  Object.assign(SL, { expression, compileFormulas, evaluateFormulas });
})();
