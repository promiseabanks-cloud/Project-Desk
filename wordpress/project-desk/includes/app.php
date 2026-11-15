<?php
/**
 * Serves the phone-first app: the page shell (with the sign-in state and REST nonce printed
 * inline), the install manifest and the service worker.
 *
 * The app answers on the portal address from settings. That can be its own host (for example
 * clients.bankssolution.ng pointed at the same WordPress folder) or a path on the main site
 * (for example bankssolution.ng/client/).
 *
 * @package Project_Desk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Host and base path of the portal address. */
function pd_portal_parts(): array {
	$url  = (string) pd_settings()['portal_url'];
	$host = strtolower( (string) wp_parse_url( $url, PHP_URL_HOST ) );
	$path = '/' . trim( (string) wp_parse_url( $url, PHP_URL_PATH ), '/' );
	return array( $host, '/' === $path ? '/' : $path . '/' );
}

/** The request path relative to the portal base, or null when this is not a portal request. */
function pd_portal_route( string $host, string $uri ): ?string {
	[ $portal_host, $base ] = pd_portal_parts();
	$path                   = '/' . ltrim( (string) wp_parse_url( $uri, PHP_URL_PATH ), '/' );
	$host                   = strtolower( preg_replace( '/:\d+$/', '', $host ) );
	$main_host              = strtolower( (string) wp_parse_url( home_url(), PHP_URL_HOST ) );
	$own_host               = $portal_host && $portal_host !== $main_host && $host === $portal_host;
	if ( $own_host ) {
		// WordPress' own paths keep working on the portal host (the API above all).
		if ( preg_match( '#^/(wp-json|wp-admin|wp-login\.php|wp-content|wp-includes|xmlrpc\.php)(/|$)#', $path ) ) {
			return null;
		}
		return ltrim( substr( $path, strlen( rtrim( $base, '/' ) ) ), '/' );
	}
	if ( $host !== $main_host && $portal_host !== $host ) {
		return null;
	}
	if ( '/' !== $base && ( $path === rtrim( $base, '/' ) || 0 === strpos( $path, $base ) ) ) {
		return ltrim( (string) substr( $path, strlen( $base ) ), '/' );
	}
	return null;
}

/** Built app files from the Vite manifest: [script, [styles]]. */
function pd_app_assets(): array {
	$manifest = PD_DIR . '/app/.vite/manifest.json';
	if ( ! file_exists( $manifest ) ) {
		return array( '', array() );
	}
	$data  = json_decode( (string) file_get_contents( $manifest ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions
	$entry = is_array( $data ) ? ( $data['index.html'] ?? null ) : null;
	if ( ! $entry ) {
		return array( '', array() );
	}
	$base = wp_make_link_relative( plugins_url( 'app/', PD_FILE ) );
	return array( $base . $entry['file'], array_map( static fn( $css ) => $base . $css, $entry['css'] ?? array() ) );
}

/**
 * Font stylesheets for the app. The Banks theme self-hosts its fonts in assets/fonts.css, so the
 * app reuses them when the active theme has that file. Other sites can add their own with the
 * pd_font_styles filter.
 */
function pd_font_styles(): array {
	$styles = array();
	foreach ( array_unique( array( get_stylesheet_directory(), get_template_directory() ) ) as $dir ) {
		if ( file_exists( $dir . '/assets/fonts.css' ) ) {
			$uri      = get_stylesheet_directory() === $dir ? get_stylesheet_directory_uri() : get_template_directory_uri();
			$styles[] = $uri . '/assets/fonts.css';
			break;
		}
	}
	return (array) apply_filters( 'pd_font_styles', $styles );
}

function pd_app_manifest(): array {
	$s           = pd_settings();
	[ , $base ]  = pd_portal_parts();
	$icon        = wp_make_link_relative( plugins_url( 'app/icon.svg', PD_FILE ) );
	return array(
		'name'             => $s['business_name'] . ' client portal',
		'short_name'       => $s['business_name'],
		'start_url'        => $base,
		'scope'            => $base,
		'display'          => 'standalone',
		'background_color' => '#f4f5f1',
		'theme_color'      => $s['brand_color'],
		'icons'            => array(
			array( 'src' => $s['logo_url'] ? $s['logo_url'] : $icon, 'sizes' => 'any', 'type' => $s['logo_url'] ? '' : 'image/svg+xml', 'purpose' => 'any' ),
		),
	);
}

function pd_app_shell( array $boot ): string {
	[ $script, $styles ] = pd_app_assets();
	[ , $base ]          = pd_portal_parts();
	$s                   = pd_settings();
	$title               = esc_html( $s['business_name'] . ' client portal' );
	$html                = "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">";
	$html               .= '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
	$html               .= '<meta name="theme-color" content="' . esc_attr( $s['brand_color'] ) . '">';
	$html               .= '<meta name="robots" content="noindex, nofollow">';
	$html               .= '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default">';
	$html               .= '<title>' . $title . '</title>';
	$html               .= '<link rel="manifest" href="' . esc_attr( $base . 'manifest.webmanifest' ) . '">';
	$html               .= '<link rel="icon" href="' . esc_attr( wp_make_link_relative( plugins_url( 'app/icon.svg', PD_FILE ) ) ) . '">';
	foreach ( pd_font_styles() as $css ) {
		$html .= '<link rel="stylesheet" href="' . esc_url( $css ) . '">';
	}
	foreach ( $styles as $css ) {
		$html .= '<link rel="stylesheet" href="' . esc_attr( $css ) . '">';
	}
	$html .= '<script>window.PD_BOOT=' . wp_json_encode( $boot, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ) . ';</script>';
	$html .= '</head><body><div id="root"></div>';
	$html .= $script
		? '<script type="module" src="' . esc_attr( $script ) . '"></script>'
		: '<p style="font-family:system-ui;padding:24px">The app has not been built yet. Run <code>bun run build</code> in wordpress/app.</p>';
	return $html . '</body></html>';
}

/** Answers portal requests before WordPress renders a theme page. */
function pd_serve_app(): void {
	$host  = isset( $_SERVER['HTTP_HOST'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_HOST'] ) ) : '';
	$uri   = isset( $_SERVER['REQUEST_URI'] ) ? esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '/';
	$route = pd_portal_route( $host, $uri );
	if ( null === $route ) {
		return;
	}
	// The portal is per-user (and carries a nonce), so page caches such as LiteSpeed must never keep it.
	if ( ! defined( 'DONOTCACHEPAGE' ) ) {
		define( 'DONOTCACHEPAGE', true );
	}
	do_action( 'litespeed_control_set_nocache', 'Project Desk portal' );
	status_header( 200 );
	header( 'X-Content-Type-Options: nosniff' );
	header( 'Referrer-Policy: same-origin' );
	if ( 'manifest.webmanifest' === $route ) {
		header( 'Content-Type: application/manifest+json; charset=utf-8' );
		header( 'Cache-Control: public, max-age=3600' );
		echo wp_json_encode( pd_app_manifest() );
		exit;
	}
	if ( 'sw.js' === $route ) {
		[ , $base ] = pd_portal_parts();
		header( 'Content-Type: text/javascript; charset=utf-8' );
		header( 'Cache-Control: no-cache' );
		header( 'Service-Worker-Allowed: ' . $base );
		$built = file_exists( PD_DIR . '/app/.vite/manifest.json' ) ? (int) filemtime( PD_DIR . '/app/.vite/manifest.json' ) : 0;
		echo str_replace( '__PD_VERSION__', PD_VERSION . '-' . $built, (string) file_get_contents( PD_DIR . '/includes/sw.js' ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions,WordPress.Security.EscapeOutput
		exit;
	}
	nocache_headers();
	header( 'Content-Type: text/html; charset=utf-8' );
	header( 'X-Frame-Options: DENY' );
	header( "Content-Security-Policy: frame-ancestors 'none'" );
	$boot          = pd_boot_payload();
	[ , $base ]    = pd_portal_parts();
	$boot['base']  = $base;
	$boot['api']   = wp_make_link_relative( rest_url( 'project-desk/v1' ) );
	echo pd_app_shell( $boot ); // phpcs:ignore WordPress.Security.EscapeOutput
	exit;
}
