<?php
/**
 * Integration tests for the Project Desk plugin against a real WordPress + MySQL install.
 *
 * Usage: php wordpress/tests/run.php /path/to/wordpress
 * The plugin must be present at wp-content/plugins/project-desk. The tests create and then
 * delete their own data; run them on a throwaway site, never on production.
 */

ob_start();
$wp_path = rtrim( $argv[1] ?? '', '/' );
if ( ! $wp_path || ! file_exists( $wp_path . '/wp-load.php' ) ) {
	fwrite( STDERR, "Pass the WordPress path.\n" );
	exit( 2 );
}
$_SERVER['HTTP_HOST']   = 'localhost';
$_SERVER['REMOTE_ADDR'] = '203.0.113.7';
$_SERVER['HTTP_USER_AGENT'] = 'ProjectDeskTests/1.0';
define( 'WP_ADMIN', false );
require $wp_path . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/user.php';

/* ------------------------------------------------------------- harness */

$GLOBALS['pd_mail'] = array();
add_filter(
	'pre_wp_mail',
	static function ( $short, $atts ) {
		$GLOBALS['pd_mail'][] = $atts;
		return true;
	},
	10,
	2
);
$GLOBALS['pd_pass'] = 0;
$GLOBALS['pd_fail'] = array();
function check( string $label, bool $ok, $detail = '' ): void {
	if ( $ok ) {
		$GLOBALS['pd_pass']++;
	} else {
		$GLOBALS['pd_fail'][] = $label . ( '' !== $detail ? ' — ' . ( is_string( $detail ) ? $detail : wp_json_encode( $detail ) ) : '' );
	}
}
function call( string $method, string $path, $body = null, array $query = array() ): WP_REST_Response {
	$req = new WP_REST_Request( $method, '/project-desk/v1' . $path );
	if ( null !== $body && is_array( $body ) ) {
		$req->set_header( 'Content-Type', 'application/json' );
		$req->set_body( wp_json_encode( $body ) );
	} elseif ( is_string( $body ) ) {
		$req->set_header( 'Content-Type', 'application/octet-stream' );
		$req->set_body( $body );
	}
	foreach ( $query as $k => $v ) {
		$req->set_query_params( $query );
	}
	$res = rest_do_request( $req );
	return rest_get_server()->response_to_data( $res, false ) !== null ? $res : $res;
}
function data( WP_REST_Response $r ) {
	return rest_get_server()->response_to_data( $r, false );
}
function as_user( int $id ): void {
	wp_set_current_user( $id );
}
function last_mail_to( string $email ): ?array {
	foreach ( array_reverse( $GLOBALS['pd_mail'] ) as $m ) {
		if ( in_array( $email, (array) $m['to'], true ) ) {
			return $m;
		}
	}
	return null;
}
function link_params( string $html, string $route ): array {
	if ( ! preg_match( '/#\/' . $route . '\?([^"]+)"/', $html, $m ) ) {
		return array();
	}
	parse_str( html_entity_decode( $m[1] ), $out );
	return $out;
}

/* --------------------------------------------------------------- setup */

global $wpdb;
activate_plugin( 'project-desk/project-desk.php' );
pd_install();
foreach ( array( 'clients', 'projects', 'phases', 'assets', 'documents', 'payments', 'messages', 'reviews', 'notifications' ) as $t ) {
	$wpdb->query( 'TRUNCATE TABLE ' . pd_table( $t ) );
}
delete_option( 'pd_settings' );
foreach ( get_users( array( 'role__in' => array( 'pd_client', 'pd_manager', 'pd_owner' ) ) ) as $u ) {
	wp_delete_user( $u->ID );
}
$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_pd\_%' OR option_name LIKE '\_transient\_timeout\_pd\_%'" );
rest_get_server();
do_action( 'rest_api_init' );

check( 'tables exist', (bool) $wpdb->get_var( "SHOW TABLES LIKE '" . pd_table( 'phases' ) . "'" ) );
check( 'roles exist', get_role( 'pd_owner' ) && get_role( 'pd_manager' ) && get_role( 'pd_client' ) );

$owner   = wp_insert_user( array( 'user_login' => 'owner1', 'user_email' => 'owner@banks.test', 'user_pass' => 'owner-pass-123', 'role' => 'pd_owner', 'display_name' => 'Promise' ) );
$manager = wp_insert_user( array( 'user_login' => 'pm1', 'user_email' => 'pm@banks.test', 'user_pass' => 'pm-pass-12345', 'role' => 'pd_manager', 'display_name' => 'Ada PM' ) );

/* ------------------------------------------------------------ signed out */

as_user( 0 );
check( 'signed out: console refused', 401 === call( 'GET', '/console' )->get_status() );
$session = data( call( 'GET', '/session' ) );
check( 'signed out: session shows brand', isset( $session['brand']['businessName'] ) && null === $session['user'] );
check( 'currency defaults to NGN', 'NGN' === $session['brand']['currency'] );

/* ------------------------------------------------------------ onboarding */

as_user( $manager );
$r = call( 'POST', '/clients', array( 'company' => 'Cedrus MFB', 'contactName' => 'Tola Ade', 'email' => 'Tola@Cedrus.test', 'service' => 'website', 'dueDate' => '2027-02-01' ) );
check( 'onboard: 201', 201 === $r->get_status(), data( $r ) );
$ob        = data( $r );
$client_id = (int) $ob['clientId'];
$project_a = (int) $ob['projectId'];
$doc_a     = (int) $ob['documentId'];
$client_u  = get_user_by( 'email', 'tola@cedrus.test' );
check( 'onboard: client account created with client role', $client_u && in_array( 'pd_client', $client_u->roles, true ) );
$invite = last_mail_to( 'tola@cedrus.test' );
check( 'onboard: invite emailed with link in fragment', $invite && link_params( $invite['message'], 'invite' ) );
$phases = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . pd_table( 'phases' ) . ' WHERE project_id = %d ORDER BY position', $project_a ), ARRAY_A );
check( 'onboard: 3 opening + 8 website phases', 11 === count( $phases ), count( $phases ) );
check( 'onboard: brief received is done, price sent in progress', 'completed' === $phases[0]['status'] && 'ongoing' === $phases[1]['status'] );
$doc = pd_get_row( 'documents', $doc_a );
check( 'onboard: agreement names the client and business', false !== strpos( $doc['body'], 'Cedrus MFB' ) && false === strpos( $doc['body'], '{business}' ) );
check( 'onboard: duplicate email refused', 409 === call( 'POST', '/clients', array( 'company' => 'X', 'contactName' => 'Y', 'email' => 'tola@cedrus.test' ) )->get_status() );
check( 'onboard: unknown service refused', 400 === call( 'POST', '/clients', array( 'company' => 'X', 'contactName' => 'Y', 'email' => 'x@y.test', 'service' => 'nope' ) )->get_status() );
check( 'onboard: staff email cannot become a client', 409 === call( 'POST', '/clients', array( 'company' => 'X', 'contactName' => 'Y', 'email' => 'pm@banks.test' ) )->get_status() );

$r2        = data( call( 'POST', '/clients', array( 'company' => 'Kuupsy', 'contactName' => 'Kay', 'email' => 'kay@kuupsy.test', 'service' => 'care' ) ) );
$client_b  = get_user_by( 'email', 'kay@kuupsy.test' );
$project_b = (int) $r2['projectId'];

/* ------------------------------------------------------------- roles */

check( 'manager: cannot add invoices', 403 === call( 'POST', "/projects/$project_a/payments", array( 'label' => 'Deposit', 'amount' => '250000', 'kind' => 'deposit' ) )->get_status() );
check( 'manager: cannot read settings', 403 === call( 'GET', '/settings' )->get_status() );
check( 'manager: cannot invite staff', 403 === call( 'POST', '/staff', array( 'email' => 'new@banks.test' ) )->get_status() );
as_user( $client_u->ID );
check( 'client: console refused', 403 === call( 'GET', '/console' )->get_status() );
check( 'client: cannot change phases', 403 === call( 'PATCH', '/phases/' . $phases[3]['id'], array( 'status' => 'ongoing' ) )->get_status() );

/* ---------------------------------------------------- isolation between clients */

as_user( $client_b->ID );
check( 'isolation: other client cannot message project', 404 === call( 'POST', "/projects/$project_a/messages", array( 'body' => 'hi' ) )->get_status() );
check( 'isolation: other client cannot upload to project', 404 === call( 'POST', "/projects/$project_a/uploads", array( 'name' => 'a.png', 'size' => 10 ) )->get_status() );
check( 'isolation: other client cannot sign document', 404 === call( 'POST', "/documents/$doc_a/sign", array( 'name' => 'Kay', 'signature' => 'data:image/png;base64,iVBORw0KGgo=', 'agree' => true ) )->get_status() );
$portal_b = data( call( 'GET', '/portal', null, array( 'clientId' => $client_id ) ) );
check( 'isolation: portal ignores clientId for clients', (int) $portal_b['client']['id'] !== $client_id );

/* ------------------------------------------------------------ gates */

as_user( $manager );
$first_work = $phases[3];
$r          = call( 'PATCH', '/phases/' . $first_work['id'], array( 'status' => 'ongoing' ) );
check( 'gate: work cannot start before signature and deposit', 409 === $r->get_status(), data( $r ) );
$r = call( 'PATCH', '/phases/' . $first_work['id'], array( 'status' => 'ongoing', 'override' => true ) );
check( 'gate: managers cannot override', 409 === $r->get_status() );

as_user( $client_u->ID );
$sig = 'data:image/png;base64,' . base64_encode( 'png-bytes' );
check( 'sign: needs agreement tick', 400 === call( 'POST', "/documents/$doc_a/sign", array( 'name' => 'Tola Ade', 'signature' => $sig ) )->get_status() );
check( 'sign: needs a drawn signature', 400 === call( 'POST', "/documents/$doc_a/sign", array( 'name' => 'Tola Ade', 'signature' => 'nope', 'agree' => true ) )->get_status() );
$r = call( 'POST', "/documents/$doc_a/sign", array( 'name' => 'Tola Ade', 'signature' => $sig, 'agree' => true ) );
check( 'sign: ok', 200 === $r->get_status(), data( $r ) );
$doc = pd_get_row( 'documents', $doc_a );
check( 'sign: evidence kept (ip, agent, hash)', '203.0.113.7' === $doc['signer_ip'] && 'ProjectDeskTests/1.0' === $doc['signer_agent'] && hash( 'sha256', $doc['body'] ) === $doc['body_hash'] );
check( 'sign: twice refused', 409 === call( 'POST', "/documents/$doc_a/sign", array( 'name' => 'Tola Ade', 'signature' => $sig, 'agree' => true ) )->get_status() );
check( 'sign: not unlocked without deposit', ! pd_work_unlocked( $project_a ) );

as_user( $manager );
check( 'documents: signed cannot be edited', 409 === call( 'PATCH', "/documents/$doc_a", array( 'body' => 'changed' ) )->get_status() );

as_user( $owner );
$pay = data( call( 'POST', "/projects/$project_a/payments", array( 'label' => 'Deposit', 'amount' => '₦250,000', 'kind' => 'deposit', 'dueDate' => '2026-01-01' ) ) );
check( 'payments: amount stored in kobo', 25000000 === (int) pd_get_row( 'payments', (int) $pay['paymentId'] )['amount'] );
$portal = data( call( 'GET', '/portal', null, array( 'clientId' => $client_id ) ) );
check( 'payments: past due shows overdue', 'overdue' === $portal['projects'][0]['payments'][0]['status'] );
call( 'PATCH', '/payments/' . $pay['paymentId'], array( 'status' => 'paid', 'method' => 'Paystack' ) );
$phases = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . pd_table( 'phases' ) . ' WHERE project_id = %d ORDER BY position', $project_a ), ARRAY_A );
check( 'unlock: opening phases complete after signature + deposit', 'completed' === $phases[2]['status'] );
check( 'unlock: first work phase started', 'ongoing' === $phases[3]['status'] );
check( 'unlock: client becomes active', 'active' === pd_get_row( 'clients', $client_id )['status'] );

/* ----------------------------------------------------------- sign-off */

as_user( $manager );
$design = $phases[5]; // Visual design, needs sign-off.
check( 'signoff: phase flagged', '1' === (string) $design['signoff'] );
call( 'PATCH', '/phases/' . $phases[4]['id'], array( 'status' => 'completed' ) );
check( 'phases: completing starts the next', 'ongoing' === pd_get_row( 'phases', (int) $design['id'] )['status'] );
$r = call( 'PATCH', '/phases/' . $design['id'], array( 'status' => 'completed' ) );
check( 'signoff: cannot complete before client approves', 409 === $r->get_status() );
$r = call( 'PATCH', '/phases/' . $phases[6]['id'], array( 'status' => 'ongoing' ) );
check( 'signoff: cannot skip past it either', 409 === $r->get_status() );
as_user( $client_b->ID );
check( 'signoff: other client cannot approve', 404 === call( 'POST', '/phases/' . $design['id'] . '/approve', array() )->get_status() );
as_user( $client_u->ID );
check( 'signoff: client approves', 200 === call( 'POST', '/phases/' . $design['id'] . '/approve', array( 'note' => 'Love it' ) )->get_status() );
as_user( $manager );
check( 'signoff: now completes', 200 === call( 'PATCH', '/phases/' . $design['id'], array( 'status' => 'completed' ) )->get_status() );

/* ------------------------------------------------------------ uploads */

as_user( $client_u->ID );
check( 'upload: php refused', 415 === call( 'POST', "/projects/$project_a/uploads", array( 'name' => 'shell.php', 'size' => 10 ) )->get_status() );
check( 'upload: html refused', 415 === call( 'POST', "/projects/$project_a/uploads", array( 'name' => 'page.html', 'size' => 10 ) )->get_status() );
$content = str_repeat( 'A', 100 ) . str_repeat( 'B', 50 );
$start   = data( call( 'POST', "/projects/$project_a/uploads", array( 'name' => 'brief notes.txt', 'size' => 150, 'category' => 'brief' ) ) );
check( 'upload: started', ! empty( $start['uploadId'] ), $start );
$uid = $start['uploadId'];
check( 'upload: finish before data refused', 409 === call( 'POST', "/uploads/$uid/finish" )->get_status() );
check( 'upload: first piece', 100 === data( call( 'PUT', "/uploads/$uid", substr( $content, 0, 100 ), array( 'offset' => 0 ) ) )['received'] );
check( 'upload: out-of-order piece refused', 409 === call( 'PUT', "/uploads/$uid", 'x', array( 'offset' => 0 ) )->get_status() );
check( 'upload: resume reports progress', 100 === data( call( 'GET', "/uploads/$uid" ) )['received'] );
as_user( $client_b->ID );
check( 'upload: other user cannot continue it', 404 === call( 'PUT', "/uploads/$uid", 'x', array( 'offset' => 100 ) )->get_status() );
as_user( $client_u->ID );
call( 'PUT', "/uploads/$uid", substr( $content, 100 ), array( 'offset' => 100 ) );
$fin = call( 'POST', "/uploads/$uid/finish" );
check( 'upload: finished', 201 === $fin->get_status(), data( $fin ) );
$asset = pd_get_row( 'assets', (int) data( $fin )['assetId'] );
check( 'upload: pending review, stored privately', 'pending' === $asset['status'] && file_exists( pd_storage_dir() . '/' . $asset['storage_key'] ) && $content === file_get_contents( pd_storage_dir() . '/' . $asset['storage_key'] ) );
check( 'upload: private folder denies web access', false !== strpos( (string) file_get_contents( pd_storage_dir() . '/.htaccess' ), 'deny' ) || false !== strpos( (string) file_get_contents( pd_storage_dir() . '/.htaccess' ), 'denied' ) );
check( 'upload: staff alerted', (bool) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . pd_table( 'notifications' ) . " WHERE audience = 'staff' AND title LIKE 'New upload%'" ) );

$h = pd_file_headers( 'image/svg+xml', 'logo.svg', 10 );
check( 'download: svg is a sandboxed attachment', 'application/octet-stream' === $h['Content-Type'] && 0 === strpos( $h['Content-Disposition'], 'attachment' ) && false !== strpos( $h['Content-Security-Policy'], 'sandbox' ) );
$h = pd_file_headers( 'text/html', 'x.txt', 10 );
check( 'download: html bytes never shown inline', 'application/octet-stream' === $h['Content-Type'] && 'nosniff' === $h['X-Content-Type-Options'] );
$h = pd_file_headers( 'video/mp4', 'clip.mp4', 10 );
check( 'download: video plays inline', 'video/mp4' === $h['Content-Type'] && 0 === strpos( $h['Content-Disposition'], 'inline' ) );

$note = call( 'POST', "/projects/$project_a/notes", array( 'title' => 'About us', 'body' => "We are a microfinance bank.\nFounded 2010." ) );
check( 'notes: client can send text', 201 === $note->get_status() );

as_user( $manager );
check( 'review: changes need a reason', 400 === call( 'PATCH', '/assets/' . $asset['id'], array( 'status' => 'changes_requested' ) )->get_status() );
check( 'review: changes with reason', 200 === call( 'PATCH', '/assets/' . $asset['id'], array( 'status' => 'changes_requested', 'note' => 'Add your logo' ) )->get_status() );

/* ------------------------------------------------------------ messages, reviews */

as_user( $client_u->ID );
check( 'messages: client posts', 201 === call( 'POST', "/projects/$project_a/messages", array( 'body' => 'Hello team' ) )->get_status() );
check( 'reviews: rating range', 400 === call( 'POST', "/projects/$project_a/reviews", array( 'rating' => 9, 'body' => 'Great work so far!' ) )->get_status() );
check( 'reviews: ok', 201 === call( 'POST', "/projects/$project_a/reviews", array( 'rating' => 5, 'body' => 'Great work so far!' ) )->get_status() );
$portal = data( call( 'GET', '/portal' ) );
check( 'portal: client sees own project with progress', $project_a === $portal['projects'][0]['id'] && $portal['projects'][0]['progress'] > 0 );

/* ------------------------------------------------------------ recurring */

as_user( $owner );
$care_phases = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . pd_table( 'phases' ) . ' WHERE project_id = %d ORDER BY position', $project_b ), ARRAY_A );
$last        = end( $care_phases );
check( 'owner: can override gate', 200 === call( 'PATCH', '/phases/' . $last['id'], array( 'status' => 'completed', 'override' => true ) )->get_status() );
check( 'recurring: care plan stays active when all phases done', 'active' === pd_get_row( 'projects', $project_b )['status'] );

/* ------------------------------------------------------------ settings, staff */

check( 'settings: bad colour refused', 400 === call( 'PUT', '/settings', array( 'brandColor' => 'red' ) )->get_status() );
check( 'settings: update', 200 === call( 'PUT', '/settings', array( 'businessName' => 'Banks Solution', 'googleClientId' => 'test-client.apps.googleusercontent.com' ) )->get_status() );
check( 'settings: reflected in session', 'Banks Solution' === data( call( 'GET', '/session' ) )['brand']['businessName'] );
$r = call( 'POST', '/staff', array( 'email' => 'tobi@banks.test', 'name' => 'Tobi', 'role' => 'manager' ) );
check( 'staff: owner invites a project manager', 201 === $r->get_status() && user_can( (int) data( $r )['userId'], 'pd_manage_projects' ) && ! user_can( (int) data( $r )['userId'], 'pd_manage_money' ) );

/* ------------------------------------------------------------ sign-in */

as_user( 0 );
$params = link_params( last_mail_to( 'tola@cedrus.test' ) ? $invite['message'] : '', 'invite' );
check( 'invite: short password refused', 400 === call( 'POST', '/auth/accept-invite', array( 'u' => $params['u'], 'k' => $params['k'], 'password' => 'short' ) )->get_status() );
check( 'invite: accepted', 200 === call( 'POST', '/auth/accept-invite', array( 'u' => $params['u'], 'k' => $params['k'], 'password' => 'a-long-password-1' ) )->get_status() );
as_user( 0 );
check( 'invite: link works only once', 400 === call( 'POST', '/auth/accept-invite', array( 'u' => $params['u'], 'k' => $params['k'], 'password' => 'another-password-2' ) )->get_status() );
check( 'login: wrong password', 401 === call( 'POST', '/auth/login', array( 'email' => 'tola@cedrus.test', 'password' => 'nope' ) )->get_status() );
$login = call( 'POST', '/auth/login', array( 'email' => 'tola@cedrus.test', 'password' => 'a-long-password-1' ) );
check( 'login: right password', 200 === $login->get_status() && get_current_user_id() === $client_u->ID );
check( 'login: returns role and a REST nonce for the app', 'client' === data( $login )['role'] && strlen( (string) data( $login )['nonce'] ) > 5 );
as_user( 0 );
$plain = wp_insert_user( array( 'user_login' => 'subscriber1', 'user_email' => 'sub@x.test', 'user_pass' => 'sub-pass-12345' ) );
check( 'login: accounts without portal access refused', 401 === call( 'POST', '/auth/login', array( 'email' => 'sub@x.test', 'password' => 'sub-pass-12345' ) )->get_status() );

$GLOBALS['pd_mail'] = array();
call( 'POST', '/auth/magic-link', array( 'email' => 'nobody@x.test' ) );
check( 'magic: unknown email sends nothing but looks the same', ! $GLOBALS['pd_mail'] );
call( 'POST', '/auth/magic-link', array( 'email' => 'kay@kuupsy.test' ) );
$m = link_params( (string) ( last_mail_to( 'kay@kuupsy.test' )['message'] ?? '' ), 'magic' );
check( 'magic: link emailed', ! empty( $m['t'] ) );
check( 'magic: wrong token refused', 401 === call( 'POST', '/auth/magic', array( 'u' => $m['u'], 't' => str_repeat( '0', 64 ) ) )->get_status() );
check( 'magic: signs in', 200 === call( 'POST', '/auth/magic', array( 'u' => $m['u'], 't' => $m['t'] ) )->get_status() && get_current_user_id() === $client_b->ID );
as_user( 0 );
check( 'magic: single use', 401 === call( 'POST', '/auth/magic', array( 'u' => $m['u'], 't' => $m['t'] ) )->get_status() );

$claims = array( 'aud' => 'test-client.apps.googleusercontent.com', 'iss' => 'https://accounts.google.com', 'exp' => time() + 600, 'email_verified' => 'true' );
add_filter( 'pd_google_claims', static fn( $c, $cred ) => 'invited' === $cred ? $claims + array( 'email' => 'kay@kuupsy.test' ) : ( 'stranger' === $cred ? $claims + array( 'email' => 'stranger@x.test' ) : ( 'wrongaud' === $cred ? array_merge( $claims, array( 'aud' => 'other', 'email' => 'kay@kuupsy.test' ) ) : ( 'unverified' === $cred ? array_merge( $claims, array( 'email_verified' => false, 'email' => 'kay@kuupsy.test' ) ) : $c ) ) ), 10, 2 );
check( 'google: invited email signs in', 200 === call( 'POST', '/auth/google', array( 'credential' => 'invited' ) )->get_status() );
as_user( 0 );
check( 'google: uninvited email refused', 403 === call( 'POST', '/auth/google', array( 'credential' => 'stranger' ) )->get_status() );
check( 'google: token for another app refused', 401 === call( 'POST', '/auth/google', array( 'credential' => 'wrongaud' ) )->get_status() );
check( 'google: unverified email refused', 401 === call( 'POST', '/auth/google', array( 'credential' => 'unverified' ) )->get_status() );

for ( $i = 0; $i < 11; $i++ ) {
	$last_status = call( 'POST', '/auth/login', array( 'email' => 'pm@banks.test', 'password' => 'wrong' ) )->get_status();
}
check( 'login: rate limited after repeated failures', 429 === $last_status );

/* ------------------------------------------------------------ app shell */

$saved = pd_settings();
pd_update_settings( array( 'portalUrl' => 'https://clients.example.test/' ) );
$main = wp_parse_url( home_url(), PHP_URL_HOST );
check( 'app: own host root is a portal page', '' === pd_portal_route( 'clients.example.test', '/' ) );
check( 'app: own host deep path served', 'manifest.webmanifest' === pd_portal_route( 'clients.example.test:443', '/manifest.webmanifest' ) );
check( 'app: API on portal host left to WordPress', null === pd_portal_route( 'clients.example.test', '/wp-json/project-desk/v1/session' ) );
check( 'app: wp-admin on portal host left alone', null === pd_portal_route( 'clients.example.test', '/wp-admin/' ) );
check( 'app: main site untouched when portal has its own host', null === pd_portal_route( $main, '/' ) && null === pd_portal_route( $main, '/about/' ) );
pd_update_settings( array( 'portalUrl' => home_url( '/client/' ) ) );
check( 'app: path portal served on main host', '' === pd_portal_route( $main, '/client/' ) && '' === pd_portal_route( $main, '/client' ) && 'sw.js' === pd_portal_route( $main, '/client/sw.js?x=1' ) );
check( 'app: other main-site pages untouched', null === pd_portal_route( $main, '/clients-stories/' ) && null === pd_portal_route( $main, '/' ) );
$shell = pd_app_shell( array( 'user' => array( 'name' => '</script><script>alert(1)</script>' ) ) );
check( 'app: boot payload cannot break out of its script tag', false === strpos( $shell, '</script><script>alert' ) );
check( 'app: shell links manifest and is noindex', false !== strpos( $shell, 'manifest.webmanifest' ) && false !== strpos( $shell, 'noindex' ) );
$manifest = pd_app_manifest();
check( 'app: manifest installs as standalone app', 'standalone' === $manifest['display'] && '/client/' === $manifest['scope'] );
pd_update_settings( array( 'portalUrl' => $saved['portal_url'] ) );

check( 'range: open-ended', array( 100, 999 ) === pd_parse_range( 'bytes=100-', 1000 ) );
check( 'range: bounded and clamped', array( 0, 1 ) === pd_parse_range( 'bytes=0-1', 1000 ) && array( 900, 999 ) === pd_parse_range( 'bytes=900-5000', 1000 ) );
check( 'range: suffix', array( 950, 999 ) === pd_parse_range( 'bytes=-50', 1000 ) );
check( 'range: outside file refused', false === pd_parse_range( 'bytes=1000-', 1000 ) && false === pd_parse_range( 'bytes=5-2', 1000 ) );
check( 'range: multi-range or junk sends whole file', null === pd_parse_range( 'bytes=0-1,5-6', 1000 ) && null === pd_parse_range( 'items=1-2', 1000 ) );

/* ------------------------------------------------------------ report */

ob_end_clean();
$fails = $GLOBALS['pd_fail'];
echo $GLOBALS['pd_pass'] . ' passed, ' . count( $fails ) . " failed\n";
foreach ( $fails as $f ) {
	echo "  FAIL: $f\n";
}
exit( $fails ? 1 : 0 );
