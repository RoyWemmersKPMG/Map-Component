import { createCustomElement, actionTypes } from '@servicenow/ui-core';
import snabbdom from '@servicenow/ui-renderer-snabbdom';
import L from 'leaflet';
import leafletStyles from 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import componentStyles from './styles.scss';

// The component renders in a shadow root, so Leaflet's CSS must be injected
// via the `styles` config key (below) rather than relying on a side-effect
// import landing in document.head.
const styles = `${leafletStyles}\n${componentStyles}`;

const {
	COMPONENT_BOOTSTRAPPED,
	COMPONENT_PROPERTY_CHANGED,
	COMPONENT_DISCONNECTED,
} = actionTypes;

// Webpack rewrites Leaflet's default marker image URLs to hashed asset paths,
// which breaks Leaflet's own relative-path lookup at runtime unless reset here.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
	iconRetinaUrl: markerIcon2x,
	iconUrl: markerIcon,
	shadowUrl: markerShadow,
});

function parsePoints(raw) {
	if (Array.isArray(raw)) return raw;
	if (typeof raw !== 'string' || raw.trim() === '') return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch (e) {
		console.error('[leaflet-map] Could not parse "points" JSON:', e);
		return [];
	}
}

// Standard ray-casting test; point and each vertex are {lat, lng}. No
// external geometry library needed for a simple "is this point inside the
// polygon the user drew" check.
function isPointInPolygon(point, vertices) {
	let inside = false;
	for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
		const vi = vertices[i];
		const vj = vertices[j];
		const intersects =
			vi.lat > point.lat !== vj.lat > point.lat &&
			point.lng <
				((vj.lng - vi.lng) * (point.lat - vi.lat)) / (vj.lat - vi.lat) +
					vi.lng;
		if (intersects) inside = !inside;
	}
	return inside;
}

// Renders the current points onto the map and returns a {marker, data} index
// so area-selection can later map "inside the polygon" back to the original
// point objects (label, popupHtml, any other caller-supplied fields).
function renderPoints(map, markersLayer, rawPoints, autoFit) {
	markersLayer.clearLayers();

	const points = parsePoints(rawPoints).filter(
		(p) => p && typeof p.lat === 'number' && typeof p.lng === 'number'
	);

	const pointsIndex = [];
	const bounds = [];
	points.forEach((p) => {
		const marker = L.marker([p.lat, p.lng]);
		if (p.label || p.popupHtml) {
			marker.bindPopup(p.popupHtml || p.label);
		}
		marker.addTo(markersLayer);
		pointsIndex.push({ marker, data: p });
		bounds.push([p.lat, p.lng]);
	});

	if (autoFit && bounds.length > 0) {
		if (bounds.length === 1) {
			map.setView(bounds[0], map.getZoom());
		} else {
			map.fitBounds(bounds, { padding: [30, 30] });
		}
	}

	return pointsIndex;
}

// Adds a "Draw area" control to the map. Click to start, click the map to
// place vertices, click the control again (or Esc) to finish/cancel. On
// finish, dispatches AREA_SELECTED with the points that fall inside the
// drawn polygon. `pointsRef` is a mutable holder kept in sync by the caller
// whenever the `points` property re-renders, so a draw that finishes after
// the data has changed still checks against the current points.
function setupAreaSelect(map, dispatch, pointsRef) {
	let drawing = false;
	let vertices = [];

	const mapContainer = map.getContainer();

	const previewLayer = L.polyline([], {
		color: '#2a81cb',
		weight: 2,
		dashArray: '6, 6',
	}).addTo(map);

	const resultLayer = L.polygon([], {
		color: '#2a81cb',
		weight: 2,
		fillOpacity: 0.15,
	});

	const button = L.DomUtil.create('a', 'leaflet-map-area-control__button');
	button.href = '#';
	button.setAttribute('role', 'button');

	function setButtonState() {
		button.textContent = drawing ? 'Finish area' : 'Draw area';
		button.title = drawing
			? 'Click the map to add points, then click here to finish (Esc to cancel)'
			: 'Draw an area to select the points inside it';
		button.classList.toggle('leaflet-map-area-control__button--active', drawing);
		L.DomUtil[drawing ? 'addClass' : 'removeClass'](mapContainer, 'leaflet-map-area-cursor');
	}
	setButtonState();

	function onMapClick(e) {
		if (!drawing) return;
		vertices.push(e.latlng);
		previewLayer.setLatLngs(vertices);
	}

	function cancelDrawing() {
		drawing = false;
		vertices = [];
		previewLayer.setLatLngs([]);
		setButtonState();
	}

	function finishDrawing() {
		drawing = false;
		previewLayer.setLatLngs([]);
		setButtonState();

		if (vertices.length < 3) {
			vertices = [];
			return;
		}

		resultLayer.setLatLngs(vertices);
		resultLayer.addTo(map);

		const polygon = vertices.map((ll) => ({ lat: ll.lat, lng: ll.lng }));
		const points = pointsRef.current
			.filter(({ data }) => isPointInPolygon(data, polygon))
			.map(({ data }) => data);

		vertices = [];
		dispatch('AREA_SELECTED', { points, polygon });
	}

	function onButtonClick() {
		if (drawing) {
			finishDrawing();
		} else {
			resultLayer.remove();
			drawing = true;
			vertices = [];
			setButtonState();
		}
	}

	function onKeydown(e) {
		if (e.key === 'Escape' && drawing) cancelDrawing();
	}

	L.DomEvent.on(button, 'click', L.DomEvent.stop).on(button, 'click', onButtonClick);
	map.on('click', onMapClick);
	document.addEventListener('keydown', onKeydown);

	const AreaControl = L.Control.extend({
		options: { position: 'topright' },
		onAdd() {
			const container = L.DomUtil.create('div', 'leaflet-map-area-control');
			L.DomEvent.disableClickPropagation(container);
			container.appendChild(button);
			return container;
		},
	});
	const control = new AreaControl().addTo(map);

	return {
		destroy() {
			map.off('click', onMapClick);
			document.removeEventListener('keydown', onKeydown);
			control.remove();
			previewLayer.remove();
			resultLayer.remove();
			L.DomUtil.removeClass(mapContainer, 'leaflet-map-area-cursor');
		},
	};
}

// snabbdom leaves a vnode's real DOM children untouched when the vnode itself
// declares none, so the div below is safe to hand off to Leaflet imperatively.
const view = () => (
	<div class={{ 'leaflet-map-wrapper': true }}>
		<div class={{ 'leaflet-map-canvas': true }}></div>
	</div>
);

createCustomElement('x-1539117-leaflet-map', {
	renderer: { type: snabbdom },
	view,
	styles,
	properties: {
		// JSON array of points, e.g. [{"lat":52.37,"lng":4.9,"label":"Amsterdam"}]
		// Bind this in UI Builder to a Data Resource, Script Include output, or a static value.
		points: { default: '[]', schema: { type: 'string' }, manageable: true },
		centerLat: { default: 20, schema: { type: 'number' }, manageable: true },
		centerLng: { default: 0, schema: { type: 'number' }, manageable: true },
		zoomLevel: { default: 2, schema: { type: 'number' }, manageable: true },
		tileLayerUrl: {
			default: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
			schema: { type: 'string' },
			manageable: true,
		},
		attribution: {
			default: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
			schema: { type: 'string' },
			manageable: true,
		},
		autoFit: { default: true, schema: { type: 'boolean' }, manageable: true },
		enableAreaSelect: { default: true, schema: { type: 'boolean' }, manageable: true },
	},
	actions: {
		// Dispatched after the user finishes drawing a shape, with the points
		// found inside it. payload: { points: [...], polygon: [{lat,lng}, ...] }
		AREA_SELECTED: { schema: { type: 'object' } },
	},
	initialState: {
		map: null,
		tileLayer: null,
		markersLayer: null,
		resizeHandler: null,
		pointsRef: null,
		areaSelect: null,
	},
	actionHandlers: {
		[COMPONENT_BOOTSTRAPPED]: ({ host, properties, updateState, dispatch }) => {
			const root = host.shadowRoot || host;
			const canvas = root.querySelector('.leaflet-map-canvas');

			const map = L.map(canvas).setView(
				[properties.centerLat, properties.centerLng],
				properties.zoomLevel
			);

			const tileLayer = L.tileLayer(properties.tileLayerUrl, {
				attribution: properties.attribution,
			}).addTo(map);

			const markersLayer = L.layerGroup().addTo(map);

			const resizeHandler = () => map.invalidateSize();
			window.addEventListener('resize', resizeHandler);

			const pointsRef = { current: [] };
			const areaSelect = properties.enableAreaSelect
				? setupAreaSelect(map, dispatch, pointsRef)
				: null;

			updateState({
				map,
				tileLayer,
				markersLayer,
				resizeHandler,
				pointsRef,
				areaSelect,
			});

			pointsRef.current = renderPoints(
				map,
				markersLayer,
				properties.points,
				properties.autoFit
			);

			// Container isn't guaranteed to have final layout dimensions on first paint.
			setTimeout(() => map.invalidateSize(), 0);
		},
		[COMPONENT_PROPERTY_CHANGED]: ({ action, state, properties, dispatch, updateState }) => {
			const { map, tileLayer, markersLayer, pointsRef, areaSelect } = state;
			if (!map) return;

			const { name, value } = action.payload;

			if (name === 'points') {
				pointsRef.current = renderPoints(map, markersLayer, value, properties.autoFit);
			} else if (name === 'centerLat' || name === 'centerLng') {
				map.setView([properties.centerLat, properties.centerLng], map.getZoom());
			} else if (name === 'zoomLevel') {
				map.setZoom(value);
			} else if (name === 'tileLayerUrl') {
				tileLayer.setUrl(value);
			} else if (name === 'attribution') {
				map.attributionControl.setPrefix(false);
				map.attributionControl.addAttribution(value);
			} else if (name === 'autoFit' && value) {
				pointsRef.current = renderPoints(map, markersLayer, properties.points, true);
			} else if (name === 'enableAreaSelect') {
				if (value && !areaSelect) {
					updateState({ areaSelect: setupAreaSelect(map, dispatch, pointsRef) });
				} else if (!value && areaSelect) {
					areaSelect.destroy();
					updateState({ areaSelect: null });
				}
			}
		},
		[COMPONENT_DISCONNECTED]: ({ state }) => {
			const { map, resizeHandler, areaSelect } = state;
			if (resizeHandler) window.removeEventListener('resize', resizeHandler);
			if (areaSelect) areaSelect.destroy();
			if (map) map.remove();
		},
	},
});
