<?php
/**
 * Plugin Name:       Project Desk
 * Description:       Client onboarding, agreements, a client upload portal, follow-ups and project tracking. The back office for the Project Desk client app.
 * Version:           0.3.0
 * Requires at least: 6.5
 * Requires PHP:      8.1
 * Author:            Banks Solution
 * Text Domain:       project-desk
 *
 * @package Project_Desk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'PD_VERSION', '0.3.0' );
define( 'PD_DB_VERSION', 2 );
define( 'PD_FILE', __FILE__ );
define( 'PD_DIR', __DIR__ );

require_once PD_DIR . '/includes/helpers.php';
require_once PD_DIR . '/includes/settings.php';
require_once PD_DIR . '/includes/install.php';
require_once PD_DIR . '/includes/notify.php';
require_once PD_DIR . '/includes/files.php';
require_once PD_DIR . '/includes/auth.php';
require_once PD_DIR . '/includes/projects.php';
require_once PD_DIR . '/includes/billing.php';
require_once PD_DIR . '/includes/api.php';
require_once PD_DIR . '/includes/app.php';

register_activation_hook( __FILE__, 'pd_activate' );

add_action( 'plugins_loaded', 'pd_maybe_upgrade' );
add_action( 'rest_api_init', 'pd_register_routes' );
add_action( 'pd_cleanup', 'pd_cleanup_stale_uploads' );
add_action( 'template_redirect', 'pd_serve_app', 0 );
add_action( 'invoicenaija_payment_recorded', 'pd_on_invoicenaija_payment', 10, 3 );
