export default [
	{
		context: ['/e/**'], // Intercept anything in your editor route
		target: 'http://localhost:1420',
		secure: false,
		bypass: function (req, res, proxyOptions) {
			// If the browser is asking for an HTML page (like when you hit refresh),
			// force the dev server to serve index.html regardless of the .md extension
			if (
				req.headers.accept &&
				req.headers.accept.indexOf('html') !== -1
			) {
				return '/index.html';
			}
		},
	},
];
