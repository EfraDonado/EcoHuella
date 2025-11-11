// Script central del frontend: aquí orquestamos todo lo que comparten las páginas
console.log('EcoHuella listo para usar la API y las utilidades del frontend.');

const API_URL = window.__ECO_API_URL || (() => {
	const { hostname } = window.location;
	const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
	return isLocalhost ? 'http://localhost:4000/api' : 'https://ecohuella.onrender.com/api';
})();

if (!window.__ECO_API_URL) {
	window.__ECO_API_URL = API_URL;
}

document.addEventListener('DOMContentLoaded', () => {
	// Arrancamos efectos globales y checamos si estamos en la calculadora
	initRipple();

	const calcRoot = document.querySelector('.calc-root[data-page="calculator"]');
	if (calcRoot) {
		initCalculator(calcRoot);
	}
});

// Efecto ripple reutilizable para darle vida a los botones protagonistas
function initRipple() {
	const rippleTargets = document.querySelectorAll('.btn-main, .btn-outline, .btn-outline-alt, .btn-login');
	rippleTargets.forEach(btn => {
		btn.addEventListener('click', event => {
			const rect = btn.getBoundingClientRect();
			const ripple = document.createElement('span');
			ripple.className = 'ripple';
			const size = Math.min(Math.max(rect.width, rect.height) * 1.1, 240);
			ripple.style.width = ripple.style.height = `${size}px`;
			ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
			ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
			ripple.style.background = btn.classList.contains('btn-outline') || btn.classList.contains('btn-outline-alt')
				? 'rgba(39,174,96,0.14)'
				: 'rgba(255,255,255,0.45)';
			btn.appendChild(ripple);
			setTimeout(() => ripple.remove(), 680);
		});
	});
}

// Punto de entrada de la calculadora avanzada; desde aquí se controla todo el flujo
function initCalculator(root) {
	const userEmail = sessionStorage.getItem('ecoUserEmail') || null;
	const LS_HISTORY_KEY = userEmail ? `eco_calculator_history_${userEmail}` : 'eco_calculator_history_v2';
	const state = {
		history: [],
		lastScore: null,
		userEmail,
		hydrated: false
	};

	const elements = {
		form: document.getElementById('calcForm'),
		sliders: Array.from(root.querySelectorAll('.slider-field input[type="range"]')),
		sliderLabels: Array.from(root.querySelectorAll('.slider-value')),
		toggles: {
			renovable: document.getElementById('chkRenovable'),
			carpool: document.getElementById('chkCarpool'),
			localFood: document.getElementById('chkLocalFood')
		},
		selects: {
			vivienda: document.getElementById('selVivienda'),
			energia: document.getElementById('selEnergia')
		},
		viviendaButtons: Array.from(root.querySelectorAll('.vivienda-btn')),
		buttons: {
			calcular: document.getElementById('btnCalcular'),
			reiniciar: document.getElementById('btnReiniciar'),
			guardar: document.getElementById('btnGuardarPlan'),
			exportar: document.getElementById('btnExportar')
		},
		scoreRing: document.getElementById('scoreRing'),
		scoreValue: document.getElementById('scoreValue'),
		scoreTitle: document.getElementById('scoreTitle'),
		scoreDescription: document.getElementById('scoreDescription'),
		scoreBadge: document.getElementById('scoreBadge'),
		breakdown: document.getElementById('breakdown'),
		planList: document.getElementById('planList'),
		historyList: document.getElementById('historyList'),
		historyContainer: document.querySelector('.history'),
		metaSlider: document.getElementById('inpMeta'),
		projections: {
			actual: document.getElementById('projActual'),
			meta: document.getElementById('projMeta'),
			impacto: document.getElementById('projImpacto')
		},
		kpis: {
			goal: document.getElementById('kpiGoal'),
			trend: document.getElementById('kpiTrend'),
			streak: document.getElementById('kpiStreak')
		},
		confettiCanvas: document.getElementById('confettiCanvas')
	};

	setupActionsMenu(root);

	// Botonera de tipo de vivienda sincronizada con el select oculto
	const viviendaButtons = elements.viviendaButtons;
	const syncViviendaButtons = value => {
		if (!viviendaButtons?.length) return;
		viviendaButtons.forEach(btn => {
			const isActive = btn.dataset.vivienda === value;
			btn.classList.toggle('is-active', isActive);
			btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
		});
	};

	if (viviendaButtons?.length) {
		viviendaButtons.forEach(btn => {
			btn.addEventListener('click', () => {
				if (!elements.selects.vivienda) return;
				elements.selects.vivienda.value = btn.dataset.vivienda;
				elements.selects.vivienda.dispatchEvent(new Event('change', { bubbles: true }));
				btn.classList.add('vivienda-btn--pulse');
			});
			btn.addEventListener('animationend', () => btn.classList.remove('vivienda-btn--pulse'));
		});
		syncViviendaButtons(elements.selects.vivienda?.value || 'departamento');
	}

	elements.selects.vivienda?.addEventListener('change', event => {
		syncViviendaButtons(event.target.value);
	});

	const categories = [
		{ id: 'energia', label: 'Energía', input: document.getElementById('inpEnergia'), weight: 0.24 },
		{ id: 'transporte', label: 'Transporte', input: document.getElementById('inpTransporte'), weight: 0.22 },
		{ id: 'alimentacion', label: 'Alimentación', input: document.getElementById('inpAlimentacion'), weight: 0.18 },
		{ id: 'residuos', label: 'Residuos', input: document.getElementById('inpResiduos'), weight: 0.18 },
		{ id: 'consumo', label: 'Consumo', input: document.getElementById('inpConsumo'), weight: 0.18 }
	];

	const confetti = buildConfetti(elements.confettiCanvas);

	// Configuramos los sliders para que muestren valores y gradientes en vivo
	categories.forEach(cat => {
		if (!cat.input) return;
		const label = root.querySelector(`.slider-value[data-for="${cat.input.id}"]`);
		const handler = () => {
			const value = parseInt(cat.input.value, 10);
			if (label) label.textContent = `${value} / 10`;
			cat.input.style.background = sliderGradient(value);
		};
		cat.input.addEventListener('input', handler);
		handler();
	});

	const metaLabel = root.querySelector('.slider-value[data-for="inpMeta"]');
	if (elements.metaSlider && metaLabel) {
		elements.metaSlider.addEventListener('input', () => {
			metaLabel.textContent = `${elements.metaSlider.value}%`;
			if (state.lastScore !== null) {
				updateProjection(elements, state.lastScore);
			}
		});
		metaLabel.textContent = `${elements.metaSlider.value}%`;
	}

	bootstrapHistory();

	elements.buttons.calcular?.addEventListener('click', async () => {
		const result = calculateFootprint(categories, elements);
		result.metaPercent = parseInt(elements.metaSlider?.value || '20', 10);
		const newHistory = [result].concat(state.history).slice(0, 6);
		commitHistory(newHistory, { hydrateFromLatest: false });
		renderResult(elements, result);
		renderBreakdown(elements.breakdown, result.breakdown);
		renderPlan(elements.planList, result.focusAreas);
		updateProjection(elements, result.score);
		updateKPIs(elements.kpis, newHistory, result);
		if (result.badge === 'Nivel verde') {
			confetti('success');
		}

		if (state.userEmail) {
			try {
				const remoteResponse = await persistCalculationRemote(result);
				if (remoteResponse?.history?.length) {
					commitHistory(remoteResponse.history, { hydrateFromLatest: false });
				} else {
					const remoteHistory = await fetchRemoteHistory();
					if (remoteHistory.length) {
						commitHistory(remoteHistory, { hydrateFromLatest: false });
					}
				}
			} catch (error) {
				console.warn('No se pudo sincronizar el cálculo', error);
			}
		} else {
			saveLocalHistory(newHistory);
		}
	});

	elements.buttons.reiniciar?.addEventListener('click', () => {
		elements.form?.reset();
		categories.forEach(cat => {
			if (cat.input) {
				cat.input.value = '5';
				cat.input.dispatchEvent(new Event('input'));
			}
		});
		syncViviendaButtons(elements.selects.vivienda?.value || 'departamento');
		resetSummary();
		resetProjection();
		state.lastScore = null;
	});

	elements.buttons.guardar?.addEventListener('click', () => {
		if (!state.history.length) return alert('Realiza un cálculo antes de guardar tu plan.');
		const latest = state.history[0];
		const metaPercent = Number.isFinite(latest.metaPercent)
			? latest.metaPercent
			: parseInt(elements.metaSlider.value, 10);
		const plan = (latest.focusAreas || []).map(item => `• ${item.title}: ${item.action}`).join('\n');
		const summary = `Huella EcoHuella\nPuntaje: ${latest.score} (${latest.badge})\nEscenario meta (${metaPercent}%): ${projectScore(latest.score, metaPercent)}\nPlan recomendado:\n${plan}`;
		navigator.clipboard?.writeText(summary).then(() => alert('Plan guardado en el portapapeles.'))
			.catch(() => alert('No se pudo copiar automáticamente, intenta manualmente.'));
	});

	elements.buttons.exportar?.addEventListener('click', () => {
		if (!state.history.length) return alert('No hay historial para exportar.');
		const rows = ['fecha,puntaje,nivel,meta_actual,energia,transporte,alimentacion,residuos,consumo'];
		state.history.forEach(item => {
			const meta = Number.isFinite(item.metaPercent)
				? item.metaPercent
				: parseInt(elements.metaSlider?.value || '0', 10);
			rows.push(`${item.dateISO},${item.score},${item.badge},${meta},${item.inputs.energia},${item.inputs.transporte},${item.inputs.alimentacion},${item.inputs.residuos},${item.inputs.consumo}`);
		});
		const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'eco_calculadora_historial.csv';
		document.body.appendChild(link);
		link.click();
		link.remove();
	});

	// Carga el historial desde localStorage y, si existe, lo pinta de inmediato
	function bootstrapHistory() {
		const cached = normalizeHistory(loadLocalHistory());
		if (cached.length) {
			commitHistory(cached, { hydrateFromLatest: true });
			state.hydrated = true;
		}
		if (!state.userEmail) return;
		fetchRemoteHistory()
			.then(remote => {
				if (remote.length) {
					commitHistory(remote, { hydrateFromLatest: !state.hydrated });
					state.hydrated = true;
				}
			})
			.catch(err => console.warn('No se pudo obtener el historial remoto.', err));
	}

	// Guarda el historial normalizado y actualiza todos los módulos dependientes
	function commitHistory(list, { hydrateFromLatest = false } = {}) {
		const normalized = normalizeHistory(list);
		state.history = normalized;
		state.lastScore = normalized.length ? normalized[0].score : null;
		renderHistory(elements.historyList, normalized);
		updateKPIs(elements.kpis, normalized, normalized[0]);
		if (state.lastScore !== null) {
			updateProjection(elements, state.lastScore);
		} else {
			resetProjection();
		}
		if (hydrateFromLatest) {
			if (normalized.length) {
				const latest = normalized[0];
				renderResult(elements, latest);
				renderBreakdown(elements.breakdown, latest.breakdown || []);
				renderPlan(elements.planList, latest.focusAreas || []);
				if (elements.metaSlider && Number.isFinite(latest.metaPercent)) {
					const minMeta = parseInt(elements.metaSlider.min || '5', 10) || 5;
					const maxMeta = parseInt(elements.metaSlider.max || '40', 10) || 40;
					const safeMeta = clamp(latest.metaPercent, minMeta, maxMeta);
					elements.metaSlider.value = safeMeta;
					const label = root.querySelector('.slider-value[data-for="inpMeta"]');
					if (label) label.textContent = `${safeMeta}%`;
				}
			} else {
				resetSummary();
			}
		}
		saveLocalHistory(normalized);
	}

	// Vuelve a dejar el resumen en su estado inicial
	function resetSummary() {
		elements.scoreValue.textContent = '—';
		elements.scoreRing?.setAttribute('stroke-dasharray', '0 360');
		elements.scoreTitle.textContent = 'Tu resultado aparecerá aquí';
		elements.scoreDescription.textContent = 'Completa los campos y pulsa “Calcular impacto”.';
		elements.scoreBadge.textContent = 'Nivel pendiente';
		elements.scoreBadge.style.background = 'rgba(39,174,96,0.12)';
		elements.scoreBadge.style.color = 'var(--eco-green-dark)';
		elements.breakdown.innerHTML = '';
		elements.planList.innerHTML = '';
	}

	// Limpia los indicadores de proyección cuando no hay datos recientes
	function resetProjection() {
		if (!elements.projections) return;
		elements.projections.actual.textContent = '—';
		elements.projections.meta.textContent = '—';
		elements.projections.impacto.textContent = '—';
	}

	// Lee el historial guardado en localStorage, manejando errores silenciosos
	function loadLocalHistory() {
		try {
			return JSON.parse(localStorage.getItem(LS_HISTORY_KEY) || '[]');
		} catch (err) {
			console.warn('No se pudo cargar el historial previo', err);
			return [];
		}
	}

	// Persiste el historial en localStorage para usarlo sin conexión
	function saveLocalHistory(list) {
		try {
			localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(list));
		} catch (err) {
			console.warn('No se pudo guardar el historial local', err);
		}
	}

	// Normaliza la estructura del historial sin importar de dónde venga
	function normalizeHistory(list) {
		return (Array.isArray(list) ? list : []).map(entry => {
			const rawInputs = entry.inputs && typeof entry.inputs === 'object' ? entry.inputs : {};
			return {
				...entry,
				inputs: {
					energia: clamp(parseInt(rawInputs.energia ?? rawInputs.ENERGIA ?? '0', 10), 0, 10),
					transporte: clamp(parseInt(rawInputs.transporte ?? rawInputs.TRANSPORTE ?? '0', 10), 0, 10),
					alimentacion: clamp(parseInt(rawInputs.alimentacion ?? rawInputs.ALIMENTACION ?? '0', 10), 0, 10),
					residuos: clamp(parseInt(rawInputs.residuos ?? rawInputs.RESIDUOS ?? '0', 10), 0, 10),
					consumo: clamp(parseInt(rawInputs.consumo ?? rawInputs.CONSUMO ?? '0', 10), 0, 10)
				},
				breakdown: Array.isArray(entry.breakdown) ? entry.breakdown : [],
				focusAreas: Array.isArray(entry.focusAreas) ? entry.focusAreas : [],
				metaPercent: typeof entry.metaPercent === 'number'
					? entry.metaPercent
					: parseInt(elements.metaSlider?.value || '20', 10),
				dateISO: entry.dateISO || entry.created_at || entry.createdAt || new Date().toISOString()
			};
		});
	}

	// Consulta el backend para traer los últimos cálculos guardados
	async function fetchRemoteHistory(limit = 6) {
		if (!state.userEmail) return [];
		const params = new URLSearchParams({ email: state.userEmail, limit: String(limit) });
		const response = await fetch(`${API_URL}/footprint/history?${params.toString()}`);
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(data.error || 'No se pudo obtener el historial remoto.');
		}
		return normalizeHistory(data.history || []);
	}

	// Envía al backend el cálculo más reciente para sincronizar la cuenta
	async function persistCalculationRemote(result) {
		if (!state.userEmail) return null;
		const payload = {
			email: state.userEmail,
			score: result.score,
			badge: result.badge,
			title: result.title,
			description: result.description,
			metaPercent: result.metaPercent,
			inputs: result.inputs,
			breakdown: result.breakdown,
			focusAreas: result.focusAreas
		};
		const response = await fetch(`${API_URL}/footprint`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(data.error || 'No se pudo guardar el cálculo.');
		}
		return data;
	}
}
// Control del menú superior desplegable con las acciones rápidas
function setupActionsMenu(scope) {
	const wrapper = scope.querySelector('.calc-actions');
	if (!wrapper) return;
	const toggle = wrapper.querySelector('#calcActionsToggle');
	const menu = wrapper.querySelector('#calcActionsMenu');
	if (!toggle || !menu) return;
	menu.setAttribute('hidden', '');

	const closeMenu = () => {
		wrapper.classList.remove('is-open');
		toggle.setAttribute('aria-expanded', 'false');
		menu.setAttribute('hidden', '');
	};

	const openMenu = () => {
		wrapper.classList.add('is-open');
		toggle.setAttribute('aria-expanded', 'true');
		menu.removeAttribute('hidden');
	};

	const handleToggle = event => {
		event.preventDefault();
		event.stopPropagation();
		if (wrapper.classList.contains('is-open')) {
			closeMenu();
		} else {
			openMenu();
		}
	};

	const handleOutsideClick = event => {
		if (!wrapper.contains(event.target)) {
			closeMenu();
		}
	};

	const handleKeydown = event => {
		if (event.key === 'Escape' && wrapper.classList.contains('is-open')) {
			closeMenu();
			toggle.focus();
		}
	};

	toggle.addEventListener('click', handleToggle);
	document.addEventListener('click', handleOutsideClick);
	document.addEventListener('keydown', handleKeydown);
	menu.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
}

// Calcula el puntaje total, define el nivel y arma oportunidades de mejora
function calculateFootprint(categories, elements) {
	const weights = { energia: 0.24, transporte: 0.22, alimentacion: 0.18, residuos: 0.18, consumo: 0.18 };
	const inputs = {};
	const breakdown = [];
	let score = 0;

	categories.forEach(cat => {
		const value = clamp(parseInt(cat.input?.value ?? '0', 10), 0, 10);
		inputs[cat.id] = value;
		const partial = value * (weights[cat.id] * 10);
		score += partial;
		breakdown.push({
			id: cat.id,
			label: cat.label,
			value,
			points: Math.round(partial),
			weight: weights[cat.id]
		});
	});

	if (elements.toggles?.renovable?.checked) score -= 6;
	if (elements.toggles?.carpool?.checked) score -= 5;
	if (elements.toggles?.localFood?.checked) score -= 4;

	switch (elements.selects?.vivienda?.value) {
		case 'compartida': score -= 3; break;
		case 'departamento': score -= 2; break;
		case 'rural': score -= 1; break;
		default: break;
	}

	switch (elements.selects?.energia?.value) {
		case 'fossil': score += 6; break;
		case 'mixta': score += 2; break;
		case 'hidro': score -= 2; break;
		case 'solar': score -= 6; break;
		default: break;
	}

	score = clamp(Math.round(score), 0, 100);
	breakdown.sort((a, b) => b.points - a.points);

	const badge = classifyScore(score);
	const narrative = buildNarrative(score, badge);
	const focusAreas = buildFocusAreas(breakdown);

	return {
		score,
		badge: badge.label,
		title: narrative.title,
		description: narrative.description,
		color: badge.color,
		breakdown,
		focusAreas,
		inputs,
		dateISO: new Date().toISOString()
	};
}

// Traduce el puntaje numérico a un nivel con su color correspondiente
function classifyScore(score) {
	if (score <= 33) return { label: 'Nivel verde', color: '#27ae60' };
	if (score <= 66) return { label: 'Nivel intermedio', color: '#f39c12' };
	return { label: 'Nivel crítico', color: '#e74c3c' };
}

// Redacta un mensaje motivador según el nivel actual
function buildNarrative(score, badge) {
	if (badge.label === 'Nivel verde') {
		return {
			title: '¡Resultados sobresalientes! 🌿',
			description: 'Tus hábitos muestran un compromiso claro con la sostenibilidad. Mantén el ritmo y comparte tu estrategia con tu comunidad.'
		};
	}
	if (badge.label === 'Nivel intermedio') {
		return {
			title: 'Buen camino, pero podemos mejorar 🌱',
			description: 'Te encuentras en un punto ideal para priorizar pequeños ajustes. Identifica la categoría líder y aplica acciones concretas esta semana.'
		};
	}
	return {
		title: 'Momento de actuar con firmeza 🔥',
		description: 'Tu impacto actual es elevado. Enfócate en las dos primeras categorías y reduce gradualmente tu huella en los próximos 30 días.'
	};
}

// Genera un plan de acción tomando las categorías más altas
function buildFocusAreas(breakdown) {
	const library = {
		energia: [
			{ title: 'Energía bajo control', action: 'Instala temporizadores o regletas inteligentes para evitar consumo fantasma.' },
			{ title: 'Transición renovable', action: 'Cotiza paneles solares comunitarios o contrata energía verde si está disponible.' }
		],
		transporte: [
			{ title: 'Movilidad combinada', action: 'Programa dos días de teletrabajo o combina transporte público/bici.' },
			{ title: 'Rutas eficientes', action: 'Unifica traslados semanales en un solo viaje para reducir emisiones.' }
		],
		alimentacion: [
			{ title: 'Platos de impacto bajo', action: 'Incorpora al menos dos comidas plant-based adicionales cada semana.' },
			{ title: 'Compra consciente', action: 'Planifica menús y compra a productores locales para reducir desperdicio.' }
		],
		residuos: [
			{ title: 'Zero waste progresivo', action: 'Instala estaciones de separación visible en casa y mide tu basura semanal.' },
			{ title: 'Compost en marcha', action: 'Explora un servicio de compostaje o composteras urbanas compartidas.' }
		],
		consumo: [
			{ title: 'Consumo circular', action: 'Evalúa cada compra con la regla de las 48 horas y prioriza productos reparables.' },
			{ title: 'Inventario inteligente', action: 'Realiza un inventario de ropa/electrónica y extiende la vida útil con mantenimiento.' }
		]
	};

	return breakdown.slice(0, 3).map(item => {
		const options = library[item.id] || [];
		const suggestion = options[item.points % options.length] || { title: 'Acción focalizada', action: 'Identifica una acción concreta para esta categoría.' };
		return suggestion;
	});
}

// Pinta el resumen principal y lanza las animaciones clave
function renderResult(elements, result) {
	animateNumber(elements.scoreValue, result.score);
	animateRing(elements.scoreRing, result.score);
	elements.scoreTitle.textContent = result.title;
	elements.scoreDescription.textContent = result.description;
	elements.scoreBadge.textContent = result.badge;
	elements.scoreBadge.style.background = `${result.color}1f`;
	elements.scoreBadge.style.color = result.color;
}

// Dibuja el desglose por categoría con barras animadas
function renderBreakdown(container, breakdown) {
	container.innerHTML = '';
	breakdown.forEach(item => {
		const wrapper = document.createElement('div');
		wrapper.className = 'breakdown-item fade-in';
		const header = document.createElement('div');
		header.className = 'breakdown-item__header';
		header.innerHTML = `<span>${item.label}</span><span>${item.points} pts</span>`;
		const bar = document.createElement('div');
		bar.className = 'breakdown-item__bar';
		const fill = document.createElement('div');
		fill.className = 'breakdown-item__fill';
		const width = Math.min(100, Math.round((item.points / 100) * 120));
		requestAnimationFrame(() => {
			fill.style.width = `${width}%`;
		});
		bar.appendChild(fill);
		wrapper.append(header, bar);
		container.appendChild(wrapper);
	});
}

// Construye la lista con el plan recomendado
function renderPlan(list, focusAreas) {
	list.innerHTML = '';
	focusAreas.forEach(item => {
		const li = document.createElement('li');
		li.className = 'action-plan__item fade-in';
		li.innerHTML = `<strong>${item.title}</strong><span>${item.action}</span>`;
		list.appendChild(li);
	});
}

// Actualiza el historial de cálculos mostrados en tarjetas
function renderHistory(container, history) {
	if (!container) return;
	container.innerHTML = '';
	history.forEach(item => {
		const card = document.createElement('article');
		card.className = 'history-card fade-in';
		const meta = document.createElement('div');
		meta.className = 'history-card__meta';
		meta.innerHTML = `<span>${formatDate(item.dateISO)}</span><span>${item.badge}</span>`;
		const score = document.createElement('div');
		score.className = 'history-card__score';
		score.textContent = `${item.score} pts`;
		const breakdown = document.createElement('div');
		breakdown.innerHTML = `<small>Prioridad: ${item.breakdown[0]?.label || '—'}</small>`;
		card.append(meta, score, breakdown);
		container.appendChild(card);
	});
}

// Calcula cómo quedaría el puntaje si cumples la meta seleccionada
function updateProjection(elements, score) {
	const meta = parseInt(elements.metaSlider?.value || '20', 10);
	const objetivo = projectScore(score, meta);
	const impacto = Math.max(0, score - objetivo);
	elements.projections.actual.textContent = `${score} pts`;
	elements.projections.meta.textContent = `${objetivo} pts`;
	elements.projections.impacto.textContent = `-${impacto} pts`;
}

// Helper para proyectar el puntaje con base en el porcentaje de meta
function projectScore(score, metaPercent) {
	const factor = 1 - (metaPercent / 100);
	return clamp(Math.round(score * factor), 0, 100);
}

// Refresca los KPIs superiores con el último cálculo
function updateKPIs(kpis, history, latest) {
	if (!kpis) return;
	if (kpis.streak) kpis.streak.textContent = history.length;
	if (kpis.trend) {
		if (history.length < 2) {
			kpis.trend.textContent = latest ? `${latest.score} pts` : '—';
		} else {
			const diff = history[0].score - history[1].score;
			const arrow = diff === 0 ? '→' : diff < 0 ? '↑' : '↓';
			kpis.trend.textContent = `${arrow} ${Math.abs(diff)} pts`;
			kpis.trend.style.color = diff <= 0 ? '#27ae60' : '#e67e22';
		}
	}
}

// Animación numérica para que el puntaje suba o baje sin saltos bruscos
function animateNumber(el, target) {
	if (!el) return;
	const start = parseInt(el.textContent.replace(/\D/g, '') || '0', 10);
	const duration = 620;
	const startTime = performance.now();

	function frame(now) {
		const progress = Math.min((now - startTime) / duration, 1);
		const value = Math.round(start + (target - start) * easeOutCubic(progress));
		el.textContent = `${value} pts`;
		if (progress < 1) requestAnimationFrame(frame);
	}
	requestAnimationFrame(frame);
}

// Anima el anillo circular del puntaje principal
function animateRing(circle, score) {
	if (!circle) return;
	const circumference = 2 * Math.PI * 52;
	const offset = ((100 - score) / 100) * circumference;
	circle.style.transition = 'stroke-dasharray 0.8s ease';
	circle.setAttribute('stroke-dasharray', `${circumference - offset} ${offset}`);
}

// Motor de confetti que celebrará los logros cuando corresponda
function buildConfetti(canvas) {
	if (!canvas) return () => {};
	const ctx = canvas.getContext('2d');
	const dpi = window.devicePixelRatio || 1;

	function resize() {
		canvas.width = window.innerWidth * dpi;
		canvas.height = window.innerHeight * dpi;
		ctx.setTransform(dpi, 0, 0, dpi, 0, 0);
	}

	resize();
	window.addEventListener('resize', resize);

	return function trigger(type = 'success') {
		const colors = type === 'success' ? ['#27ae60', '#2ecc71', '#a3f7b5'] : ['#f39c12', '#ffeaa7', '#ff7675'];
		const pieces = Array.from({ length: 80 }, () => ({
			x: Math.random() * window.innerWidth,
			y: -20 - Math.random() * 180,
			vx: (Math.random() - 0.5) * 5,
			vy: Math.random() * 4 + 1.8,
			size: Math.random() * 5 + 3,
			color: colors[Math.floor(Math.random() * colors.length)],
			rotation: Math.random() * 360
		}));

		let frameId;
		function draw() {
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			pieces.forEach(piece => {
				piece.x += piece.vx;
				piece.y += piece.vy;
				piece.vy += 0.1;
				piece.rotation += piece.vx * 0.7;
				ctx.save();
				ctx.translate(piece.x, piece.y);
				ctx.rotate((piece.rotation * Math.PI) / 180);
				ctx.fillStyle = piece.color;
				ctx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 0.6);
				ctx.restore();
			});

			if (pieces.every(p => p.y > window.innerHeight + 80)) {
				cancelAnimationFrame(frameId);
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				return;
			}
			frameId = requestAnimationFrame(draw);
		}
		draw();
	};
}

// Colección de utilidades pequeñitas que usa toda la calculadora
function clamp(value, min, max) {
	if (Number.isNaN(value)) return min;
	return Math.max(min, Math.min(max, value));
}

function easeOutCubic(t) {
	return 1 - Math.pow(1 - t, 3);
}

function sliderGradient(value) {
	const percent = (value / 10) * 100;
	return `linear-gradient(90deg, rgba(39,174,96,0.9) 0%, rgba(39,174,96,0.9) ${percent}%, rgba(221,240,227,0.8) ${percent}%)`;
}

function formatDate(iso) {
	const date = new Date(iso);
	return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
