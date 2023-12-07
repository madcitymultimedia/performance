/** @typedef {import("web-vitals").LCPMetric} LCPMetric */

const win = window;
const doc = win.document;

const consoleLogPrefix = '[Image Loading Optimization]';

const storageLockTimeSessionKey = 'iloStorageLockTime';

const adminBarId = 'wpadminbar';

/**
 * Checks whether storage is locked.
 *
 * @param {number} currentTime    - Current time in milliseconds.
 * @param {number} storageLockTTL - Storage lock TTL in seconds.
 * @return {boolean} Whether storage is locked.
 */
function isStorageLocked( currentTime, storageLockTTL ) {
	if ( storageLockTTL === 0 ) {
		return false;
	}

	try {
		const storageLockTime = parseInt(
			sessionStorage.getItem( storageLockTimeSessionKey )
		);
		return (
			! isNaN( storageLockTime ) &&
			currentTime < storageLockTime + storageLockTTL * 1000
		);
	} catch ( e ) {
		return false;
	}
}

/**
 * Set the storage lock.
 *
 * @param {number} currentTime - Current time in milliseconds.
 */
function setStorageLock( currentTime ) {
	try {
		sessionStorage.setItem(
			storageLockTimeSessionKey,
			String( currentTime )
		);
	} catch ( e ) {}
}

/**
 * Log a message.
 *
 * @param {...*} message
 */
function log( ...message ) {
	// eslint-disable-next-line no-console
	console.log( consoleLogPrefix, ...message );
}

/**
 * Log a warning.
 *
 * @param {...*} message
 */
function warn( ...message ) {
	// eslint-disable-next-line no-console
	console.warn( consoleLogPrefix, ...message );
}

/**
 * Log an error.
 *
 * @param {...*} message
 */
function error( ...message ) {
	// eslint-disable-next-line no-console
	console.error( consoleLogPrefix, ...message );
}

/**
 * @typedef {Object} Breadcrumb
 * @property {number} index - Index of element among sibling elements.
 * @property {string} tag   - Tag name.
 */

/**
 * @typedef {Object} ElementMetrics
 * @property {boolean}         isLCP              - Whether it is the LCP candidate.
 * @property {boolean}         isLCPCandidate     - Whether it is among the LCP candidates.
 * @property {Breadcrumb[]}    breadcrumbs        - Breadcrumbs.
 * @property {number}          intersectionRatio  - Intersection ratio.
 * @property {DOMRectReadOnly} intersectionRect   - Intersection rectangle.
 * @property {DOMRectReadOnly} boundingClientRect - Bounding client rectangle.
 */

/**
 * @typedef {Object} URLMetrics
 * @property {string}           url             - URL of the page.
 * @property {Object}           viewport        - Viewport.
 * @property {number}           viewport.width  - Viewport width.
 * @property {number}           viewport.height - Viewport height.
 * @property {ElementMetrics[]} elements        - Metrics for the elements observed on the page.
 */

/**
 * Gets element index among siblings.
 *
 * @todo Eliminate this in favor of doing all breadcrumb generation exclusively on the server.
 *
 * @param {Element} element Element.
 * @return {number} Index.
 */
function getElementIndex( element ) {
	if ( ! element.parentElement ) {
		return 0;
	}
	const children = [ ...element.parentElement.children ];
	let index = children.indexOf( element );
	if ( children.includes( document.getElementById( adminBarId ) ) ) {
		--index;
	}
	if (
		children.includes(
			document.querySelector( '.skip-link.screen-reader-text' )
		)
	) {
		--index;
	}
	return index;
}

/**
 * Gets breadcrumbs for a given element.
 *
 * @todo Eliminate this in favor of doing all breadcrumb generation exclusively on the server.
 *
 * @param {Element} leafElement
 * @return {Breadcrumb[]} Breadcrumbs.
 */
function getBreadcrumbs( leafElement ) {
	/** @type {Breadcrumb[]} */
	const breadcrumbs = [];

	let element = leafElement;
	while ( element instanceof Element ) {
		breadcrumbs.unshift( {
			tag: element.tagName,
			index: getElementIndex( element ),
		} );
		element = element.parentElement;
	}

	return breadcrumbs;
}

/**
 * Checks whether the URL metric(s) for the provided viewport width is needed.
 *
 * @param {number}                   viewportWidth               - Current viewport width.
 * @param {Array<number, boolean>[]} neededMinimumViewportWidths - Needed minimum viewport widths, in ascending order.
 * @return {boolean} Whether URL metrics are needed.
 */
function isViewportNeeded( viewportWidth, neededMinimumViewportWidths ) {
	let lastWasNeeded = false;
	for ( const [
		minimumViewportWidth,
		isNeeded,
	] of neededMinimumViewportWidths ) {
		if ( viewportWidth >= minimumViewportWidth ) {
			lastWasNeeded = isNeeded;
		} else {
			break;
		}
	}
	return lastWasNeeded;
}

/**
 * Gets the current time in milliseconds.
 *
 * @return {number} Current time in milliseconds.
 */
function getCurrentTime() {
	return Date.now();
}

/**
 * Detects the LCP element, loaded images, client viewport and store for future optimizations.
 *
 * @param {Object}                   args                             Args.
 * @param {number}                   args.serveTime                   The serve time of the page in milliseconds from PHP via `microtime( true ) * 1000`.
 * @param {number}                   args.detectionTimeWindow         The number of milliseconds between now and when the page was first generated in which detection should proceed.
 * @param {boolean}                  args.isDebug                     Whether to show debug messages.
 * @param {string}                   args.restApiEndpoint             URL for where to send the detection data.
 * @param {string}                   args.restApiNonce                Nonce for writing to the REST API.
 * @param {string}                   args.urlMetricsSlug              Slug for URL metrics.
 * @param {string}                   args.urlMetricsNonce             Nonce for URL metrics storage.
 * @param {Array<number, boolean>[]} args.neededMinimumViewportWidths Needed minimum viewport widths for URL metrics.
 * @param {number}                   args.storageLockTTL              The TTL (in seconds) for the URL metric storage lock.
 */
export default async function detect( {
	serveTime,
	detectionTimeWindow,
	isDebug,
	restApiEndpoint,
	restApiNonce,
	urlMetricsSlug,
	urlMetricsNonce,
	neededMinimumViewportWidths,
	storageLockTTL,
} ) {
	const currentTime = getCurrentTime();

	// As an alternative to this, the ilo_print_detection_script() function can short-circuit if the
	// ilo_is_url_metric_storage_locked() function returns true. However, the downside with that is page caching could
	// result in metrics being missed being gathered when a user navigates around a site and primes the page cache.
	if ( isStorageLocked( currentTime, storageLockTTL ) ) {
		if ( isDebug ) {
			warn( 'Aborted detection due to storage being locked.' );
		}
		return;
	}

	// Abort running detection logic if it was served in a cached page.
	if ( currentTime - serveTime > detectionTimeWindow ) {
		if ( isDebug ) {
			warn(
				'Aborted detection due to being outside detection time window.'
			);
		}
		return;
	}

	// Prevent detection when page is not scrolled to the initial viewport.
	// TODO: Does this cause layout/reflow? https://gist.github.com/paulirish/5d52fb081b3570c81e3a
	if ( doc.documentElement.scrollTop > 0 ) {
		if ( isDebug ) {
			warn(
				'Aborted detection since initial scroll position of page is not at the top.'
			);
		}
		return;
	}

	if ( ! isViewportNeeded( win.innerWidth, neededMinimumViewportWidths ) ) {
		if ( isDebug ) {
			log( 'No need for URL metrics from the current viewport.' );
		}
		return;
	}

	if ( isDebug ) {
		log( 'Proceeding with detection' );
	}

	// Obtain the admin bar element because we don't want to detect elements inside of it.
	const adminBar =
		/** @type {?HTMLDivElement} */ doc.getElementById( adminBarId );

	// We need to capture the original elements and their breadcrumbs as early as possible in case JavaScript is
	// mutating the DOM from the original HTML rendered by the server, in which case the breadcrumbs obtained from the
	// client will no longer be valid on the server. As such, the results are stored in an array and not any live list.
	const breadcrumbedImages = doc.body.querySelectorAll( 'img' );

	// We do the same for elements with background images which are not data: URLs.
	// TODO: Re-enable background image support when server-side is implemented.
	// const breadcrumbedElementsWithBackgrounds = Array.from(
	// 	doc.body.querySelectorAll( '[style*="background"]' )
	// ).filter( ( /** @type {Element} */ el ) =>
	// 	/url\(\s*['"](?!=data:)/.test( el.style.backgroundImage )
	// );

	/** @type {Map<Element, Breadcrumb[]>} */
	const breadcrumbedElementsMap = new Map(
		[
			...breadcrumbedImages /*, ...breadcrumbedElementsWithBackgrounds*/,
		].map(
			// TODO: Instead of generating breadcrumbs here, rely instead on server-generated breadcrumbs that are added to a data attribute by the server.
			( element ) => [ element, getBreadcrumbs( element ) ]
		)
	);

	// Ensure the DOM is loaded (although it surely already is since we're executing in a module).
	await new Promise( ( resolve ) => {
		if ( doc.readyState !== 'loading' ) {
			resolve();
		} else {
			doc.addEventListener( 'DOMContentLoaded', resolve, { once: true } );
		}
	} );

	/** @type {IntersectionObserverEntry[]} */
	const elementIntersections = [];

	/** @type {?IntersectionObserver} */
	let intersectionObserver;

	function disconnectIntersectionObserver() {
		if ( intersectionObserver instanceof IntersectionObserver ) {
			intersectionObserver.disconnect();
			win.removeEventListener( 'scroll', disconnectIntersectionObserver ); // Clean up, even though this is registered with once:true.
		}
	}

	// Wait for the intersection observer to report back on the initially-visible elements.
	// Note that the first callback will include _all_ observed entries per <https://github.com/w3c/IntersectionObserver/issues/476>.
	if ( breadcrumbedElementsMap.size > 0 ) {
		await new Promise( ( resolve ) => {
			intersectionObserver = new IntersectionObserver(
				( entries ) => {
					for ( const entry of entries ) {
						if ( entry.isIntersecting ) {
							elementIntersections.push( entry );
						}
					}
					resolve();
				},
				{
					root: null, // To watch for intersection relative to the device's viewport.
					threshold: 0.0, // As soon as even one pixel is visible.
				}
			);

			for ( const element of breadcrumbedElementsMap.keys() ) {
				if ( ! adminBar || ! adminBar.contains( element ) ) {
					intersectionObserver.observe( element );
				}
			}
		} );

		// Stop observing as soon as the page scrolls since we only want initial-viewport elements.
		win.addEventListener( 'scroll', disconnectIntersectionObserver, {
			once: true,
			passive: true,
		} );
	}

	// TODO: Use a local copy of web-vitals.
	const { onLCP } = await import(
		// eslint-disable-next-line import/no-unresolved
		'https://unpkg.com/web-vitals@3/dist/web-vitals.js?module'
	);

	/** @type {LCPMetric[]} */
	const lcpMetricCandidates = [];

	// Obtain at least one LCP candidate. More may be reported before the page finishes loading.
	await new Promise( ( resolve ) => {
		onLCP(
			( metric ) => {
				lcpMetricCandidates.push( metric );
				resolve();
			},
			{
				// This avoids needing to click to finalize LCP candidate. While this is helpful for testing, it also
				// ensures that we always get an LCP candidate reported. Otherwise, the callback may never fire if the
				// user never does a click or keydown, per <https://github.com/GoogleChrome/web-vitals/blob/07f6f96/src/onLCP.ts#L99-L107>.
				reportAllChanges: true,
			}
		);
	} );

	// Wait until the resources on the page have fully loaded.
	await new Promise( ( resolve ) => {
		if ( doc.readyState === 'complete' ) {
			resolve();
		} else {
			win.addEventListener( 'load', resolve, { once: true } );
		}
	} );

	// Stop observing.
	disconnectIntersectionObserver();
	if ( isDebug ) {
		log( 'Detection is stopping.' );
	}

	/** @type {URLMetrics} */
	const urlMetrics = {
		url: win.location.href,
		slug: urlMetricsSlug,
		nonce: urlMetricsNonce,
		viewport: {
			width: win.innerWidth,
			height: win.innerHeight,
		},
		elements: [],
	};

	const lcpMetric = lcpMetricCandidates.at( -1 );

	for ( const elementIntersection of elementIntersections ) {
		const breadcrumbs = breadcrumbedElementsMap.get(
			elementIntersection.target
		);
		if ( ! breadcrumbs ) {
			if ( isDebug ) {
				error( 'Unable to look up breadcrumbs for element' );
			}
			continue;
		}

		const isLCP =
			elementIntersection.target === lcpMetric?.entries[ 0 ]?.element;

		/** @type {ElementMetrics} */
		const elementMetrics = {
			isLCP,
			isLCPCandidate: !! lcpMetricCandidates.find(
				( lcpMetricCandidate ) =>
					lcpMetricCandidate.entries[ 0 ]?.element ===
					elementIntersection.target
			),
			breadcrumbs,
			intersectionRatio: elementIntersection.intersectionRatio,
			intersectionRect: elementIntersection.intersectionRect,
			boundingClientRect: elementIntersection.boundingClientRect,
		};

		urlMetrics.elements.push( elementMetrics );
	}

	if ( isDebug ) {
		log( 'URL metrics:', urlMetrics );
	}

	// TODO: Wait until idle? Yield to main?
	try {
		const response = await fetch( restApiEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': restApiNonce,
			},
			body: JSON.stringify( urlMetrics ),
		} );

		if ( response.status === 200 ) {
			setStorageLock( getCurrentTime() );
		}

		if ( isDebug ) {
			const body = await response.json();
			if ( response.status === 200 ) {
				log( 'Response:', body );
			} else {
				error( 'Failure:', body );
			}
		}
	} catch ( err ) {
		if ( isDebug ) {
			error( err );
		}
	}

	// Clean up.
	breadcrumbedElementsMap.clear();
}
