import '../src/x-1539117-leaflet-map';

const el = document.createElement('DIV');
el.style.height = '600px';
document.body.appendChild(el);

el.innerHTML = `
	<x-1539117-leaflet-map
		points='[{"lat":52.3676,"lng":4.9041,"label":"Amsterdam"},{"lat":51.5074,"lng":-0.1278,"label":"London"},{"lat":48.8566,"lng":2.3522,"label":"Paris"}]'
	></x-1539117-leaflet-map>
`;
