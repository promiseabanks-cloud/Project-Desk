<?php
/**
 * REST API under /wp-json/project-desk/v1. The app signs in with a WordPress cookie and sends
 * the X-WP-Nonce header from /session on every request, which also protects against
 * cross-site requests.
 *
 * @package Project_Desk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const PD_NS = 'project-desk/v1';

/* ------------------------------------------------------------- permissions */

function pd_can_staff(): bool {
	return current_user_can( 'pd_manage_projects' );
}
function pd_can_money(): bool {
	return current_user_can( 'pd_manage_money' );
}
function pd_can_settings(): bool {
	return current_user_can( 'pd_manage_settings' );
}
function pd_can_manage_staff(): bool {
	return current_user_can( 'pd_manage_staff' );
}
function pd_can_client(): bool {
	return current_user_can( 'pd_client_portal' ) && pd_client_id_for_user( get_current_user_id() ) > 0;
}
function pd_can_any(): bool {
	return pd_can_staff() || pd_can_client();
}

/** The project if the current user may see it (staff: any; client: their own). */
function pd_project_for_current_user( int $project_id ): ?array {
	$project = pd_get_row( 'projects', $project_id );
	if ( ! $project ) {
		return null;
	}
	if ( pd_can_staff() ) {
		return $project;
	}
	return (int) $project['client_id'] === pd_client_id_for_user( get_current_user_id() ) ? $project : null;
}

function pd_json_body( WP_REST_Request $r ): array {
	$body = $r->get_json_params();
	return is_array( $body ) ? $body : array();
}

function pd_route( string $path, string $methods, callable $callback, callable $permission ): void {
	register_rest_route(
		PD_NS,
		$path,
		array(
			'methods'             => $methods,
			'callback'            => $callback,
			'permission_callback' => $permission,
		)
	);
}

function pd_register_routes(): void {
	$public = '__return_true';

	/* --------------------------------------------------------------- session */

	// Signed-out callers get the brand; signed-in callers (with the nonce) get the same payload the app page boots with.
	pd_route( '/session', 'GET', static fn() => pd_boot_payload(), $public );

	/* ------------------------------------------------------------------ auth */

	$signed_in = static fn( $user ) => is_wp_error( $user ) ? $user : array( 'ok' => true ) + pd_boot_payload();

	pd_route(
		'/auth/login',
		'POST',
		static function ( WP_REST_Request $r ) use ( $signed_in ) {
			$b = pd_json_body( $r );
			return $signed_in( pd_password_login( (string) ( $b['email'] ?? '' ), (string) ( $b['password'] ?? '' ) ) );
		},
		$public
	);
	pd_route(
		'/auth/magic-link',
		'POST',
		static function ( WP_REST_Request $r ) {
			pd_request_magic_link( (string) ( pd_json_body( $r )['email'] ?? '' ) );
			return array( 'ok' => true, 'message' => 'If that email has portal access, a sign-in link is on its way.' );
		},
		$public
	);
	pd_route(
		'/auth/magic',
		'POST',
		static function ( WP_REST_Request $r ) use ( $signed_in ) {
			$b = pd_json_body( $r );
			return $signed_in( pd_consume_magic_link( (int) ( $b['u'] ?? 0 ), (string) ( $b['t'] ?? '' ) ) );
		},
		$public
	);
	pd_route(
		'/auth/google',
		'POST',
		static function ( WP_REST_Request $r ) use ( $signed_in ) {
			return $signed_in( pd_google_login( (string) ( pd_json_body( $r )['credential'] ?? '' ) ) );
		},
		$public
	);
	pd_route(
		'/auth/accept-invite',
		'POST',
		static function ( WP_REST_Request $r ) use ( $signed_in ) {
			$b = pd_json_body( $r );
			return $signed_in( pd_accept_invite( (int) ( $b['u'] ?? 0 ), (string) ( $b['k'] ?? '' ), (string) ( $b['password'] ?? '' ) ) );
		},
		$public
	);
	pd_route(
		'/auth/logout',
		'POST',
		static function () {
			wp_logout();
			return array( 'ok' => true );
		},
		'is_user_logged_in'
	);

	/* ------------------------------------------------------- staff: console */

	pd_route(
		'/console',
		'GET',
		static function () {
			global $wpdb;
			$clients = $wpdb->get_results( 'SELECT * FROM ' . pd_table( 'clients' ) . ' ORDER BY created_at DESC, id DESC', ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			return array(
				'clients'       => array_map( 'pd_map_client', $clients ),
				'projects'      => pd_load_projects( 0, true ),
				'documents'     => pd_load_documents( 0, true ),
				'notifications' => pd_load_notifications( 'staff' ),
				'services'      => pd_settings()['services'],
			);
		},
		'pd_can_staff'
	);

	pd_route(
		'/clients',
		'POST',
		static function ( WP_REST_Request $r ) {
			$result = pd_onboard_client( pd_json_body( $r ) );
			return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 201 );
		},
		'pd_can_staff'
	);

	pd_route(
		'/clients/(?P<id>\d+)',
		'PATCH',
		static function ( WP_REST_Request $r ) {
			global $wpdb;
			$id = (int) $r['id'];
			if ( ! pd_get_row( 'clients', $id ) ) {
				return pd_error( 'Client not found.', 404 );
			}
			$b      = pd_json_body( $r );
			$fields = array();
			if ( isset( $b['status'] ) ) {
				$fields['status'] = pd_one_of( $b['status'], array( 'onboarding', 'active', 'paused', 'archived' ), 'active' );
			}
			foreach ( array( 'company' => 160, 'contactName' => 160, 'phone' => 40, 'industry' => 80 ) as $k => $max ) {
				if ( isset( $b[ $k ] ) && '' !== pd_text( $b[ $k ], $max ) ) {
					$fields[ 'contactName' === $k ? 'contact_name' : $k ] = pd_text( $b[ $k ], $max );
				}
			}
			if ( isset( $b['notes'] ) ) {
				$fields['notes'] = pd_textarea( $b['notes'], 4000 );
			}
			if ( $fields ) {
				$wpdb->update( pd_table( 'clients' ), $fields, array( 'id' => $id ) );
			}
			return pd_map_client( pd_get_row( 'clients', $id ) );
		},
		'pd_can_staff'
	);

	pd_route(
		'/clients/(?P<id>\d+)/invite',
		'POST',
		static function ( WP_REST_Request $r ) {
			$client = pd_get_row( 'clients', (int) $r['id'] );
			$user   = $client && $client['user_id'] ? get_user_by( 'id', (int) $client['user_id'] ) : null;
			if ( ! $user ) {
				return pd_error( 'Client not found.', 404 );
			}
			return array( 'ok' => pd_send_invite( $user ) );
		},
		'pd_can_staff'
	);

	pd_route(
		'/projects',
		'POST',
		static function ( WP_REST_Request $r ) {
			$b      = pd_json_body( $r );
			$client = pd_get_row( 'clients', (int) ( $b['clientId'] ?? 0 ) );
			$name   = pd_text( $b['name'] ?? '', 160 );
			if ( ! $client || ! $name ) {
				return pd_error( 'Choose a client and name the project.' );
			}
			[ $price, $pct ] = pd_price_input( $b );
			$id              = pd_create_project( (int) $client['id'], $name, sanitize_key( (string) ( $b['service'] ?? '' ) ), pd_textarea( $b['summary'] ?? '', 2000 ), pd_date( $b['dueDate'] ?? '' ), null, $price, $pct, pd_milestones_input( $b ) );
			if ( is_wp_error( $id ) ) {
				return $id;
			}
			if ( pd_agreement_signed( $id ) ) {
				pd_create_deposit_invoice( $id );
			}
			pd_notify(
				array(
					array(
						'audience'   => 'client',
						'client_id'  => (int) $client['id'],
						'project_id' => $id,
						'title'      => 'New project added: ' . $name,
						'body'       => 'A new project is now in your portal.',
						'channels'   => array( 'email' ),
						'email'      => $client['email'],
					),
				)
			);
			return new WP_REST_Response( array( 'projectId' => $id ), 201 );
		},
		'pd_can_staff'
	);

	pd_route(
		'/projects/(?P<id>\d+)',
		'PATCH',
		static function ( WP_REST_Request $r ) {
			global $wpdb;
			$id = (int) $r['id'];
			if ( ! pd_get_row( 'projects', $id ) ) {
				return pd_error( 'Project not found.', 404 );
			}
			$b      = pd_json_body( $r );
			$fields = array();
			if ( isset( $b['status'] ) ) {
				$fields['status'] = pd_one_of( $b['status'], array( 'active', 'on_hold', 'completed', 'cancelled' ), 'active' );
			}
			if ( isset( $b['name'] ) && pd_text( $b['name'], 160 ) ) {
				$fields['name'] = pd_text( $b['name'], 160 );
			}
			if ( isset( $b['summary'] ) ) {
				$fields['summary'] = pd_textarea( $b['summary'], 2000 );
			}
			if ( array_key_exists( 'dueDate', $b ) ) {
				$fields['due_date'] = pd_date( $b['dueDate'] );
			}
			if ( current_user_can( 'pd_manage_money' ) ) {
				[ $price, $pct ] = pd_price_input( $b );
				if ( array_key_exists( 'price', $b ) ) {
					$fields['price'] = $price;
				}
				if ( null !== $pct ) {
					$fields['deposit_percent'] = $pct;
				}
			}
			if ( $fields ) {
				$wpdb->update( pd_table( 'projects' ), $fields, array( 'id' => $id ) );
			}
			if ( isset( $fields['price'] ) && pd_agreement_signed( $id ) ) {
				pd_create_deposit_invoice( $id );
			}
			return array( 'ok' => true );
		},
		'pd_can_staff'
	);

	pd_route(
		'/projects/(?P<id>\d+)/phases',
		'POST',
		static function ( WP_REST_Request $r ) {
			global $wpdb;
			$id   = (int) $r['id'];
			$b    = pd_json_body( $r );
			$name = pd_text( $b['name'] ?? '', 160 );
			if ( ! pd_get_row( 'projects', $id ) ) {
				return pd_error( 'Project not found.', 404 );
			}
			if ( ! $name ) {
				return pd_error( 'Give the phase a name.' );
			}
			$last = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COALESCE(MAX(position), -1) FROM ' . pd_table( 'phases' ) . ' WHERE project_id = %d', $id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$wpdb->insert(
				pd_table( 'phases' ),
				array(
					'project_id' => $id,
					'name'       => $name,
					'position'   => $last + 1,
					'stage'      => 'work',
					'signoff'    => ! empty( $b['signoff'] ) ? 1 : 0,
					'status'     => 'queued',
				)
			);
			$phase_id = (int) $wpdb->insert_id;
			$wpdb->update( pd_table( 'projects' ), array( 'status' => 'active' ), array( 'id' => $id, 'status' => 'completed' ) );
			return new WP_REST_Response( array( 'phaseId' => $phase_id ), 201 );
		},
		'pd_can_staff'
	);

	pd_route(
		'/phases/(?P<id>\d+)',
		'PATCH',
		static function ( WP_REST_Request $r ) {
			global $wpdb;
			$b     = pd_json_body( $r );
			$phase = pd_get_row( 'phases', (int) $r['id'] );
			if ( ! $phase ) {
				return pd_error( 'Phase not found.', 404 );
			}
			// Editing the phase itself (name, sign-off, payment milestone).
			$fields = array();
			if ( isset( $b['name'] ) && pd_text( $b['name'], 160 ) ) {
				$fields['name'] = pd_text( $b['name'], 160 );
			}
			if ( array_key_exists( 'signoff', $b ) ) {
				$fields['signoff'] = ! empty( $b['signoff'] ) ? 1 : 0;
			}
			if ( array_key_exists( 'billPercent', $b ) && current_user_can( 'pd_manage_money' ) ) {
				$fields['bill_percent'] = max( 0, min( 100, (int) $b['billPercent'] ) );
			}
			if ( $fields ) {
				$wpdb->update( pd_table( 'phases' ), $fields, array( 'id' => $phase['id'] ) );
			}
			// Changing the phase's status, when asked.
			if ( isset( $b['status'] ) && '' !== $b['status'] ) {
				$override = ! empty( $b['override'] ) && current_user_can( 'pd_override_gates' );
				return pd_set_phase_status( (int) $r['id'], (string) $b['status'], pd_textarea( $b['note'] ?? '', 2000 ), $override );
			}
			return array( 'ok' => true );
		},
		'pd_can_staff'
	);

	pd_route(
		'/assets/(?P<id>\d+)',
		'PATCH',
		static function ( WP_REST_Request $r ) {
			global $wpdb;
			$asset = pd_get_row( 'assets', (int) $r['id'] );
			if ( ! $asset ) {
				return pd_error( 'Asset not found.', 404 );
			}
			$b      = pd_json_body( $r );
			$status = pd_one_of( $b['status'] ?? '', array( 'accepted', 'changes_requested', 'pending' ), '' );
			$note   = pd_textarea( $b['note'] ?? '', 1000 );
			if ( ! $status ) {
				return pd_error( 'Choose accepted or changes requested.' );
			}
			if ( 'changes_requested' === $status && ! $note ) {
				return pd_error( 'Say what needs to change so the client can fix it.' );
			}
			$wpdb->update(
				pd_table( 'assets' ),
				array( 'status' => $status, 'review_note' => $note, 'reviewed_at' => pd_now(), 'reviewed_by' => get_current_user_id() ),
				array( 'id' => $asset['id'] )
			);
			if ( 'pending' !== $status ) {
				$client = pd_get_row( 'clients', (int) $asset['client_id'] );
				pd_notify(
					array(
						array(
							'audience'   => 'client',
							'client_id'  => (int) $asset['client_id'],
							'project_id' => (int) $asset['project_id'],
							'title'      => 'accepted' === $status ? "Accepted: {$asset['name']}" : "Changes needed: {$asset['name']}",
							'body'       => 'accepted' === $status ? 'Thanks, this file is approved and in use.' : "The team asked for changes: {$note}",
							'channels'   => array( 'email' ),
							'email'      => $client['email'] ?? '',
						),
					)
				);
			}
			return array( 'ok' => true, 'status' => $status );
		},
		'pd_can_staff'
	);

	pd_route(
		'/projects/(?P<id>\d+)/payments',
		'POST',
		static function ( WP_REST_Request $r ) {
			global $wpdb;
			$project = pd_get_row( 'projects', (int) $r['id'] );
			if ( ! $project ) {
				return pd_error( 'Project not found.', 404 );
			}
			$b          = pd_json_body( $r );
			$label      = pd_text( $b['label'] ?? '', 160 );
			$amount     = pd_money( $b['amount'] ?? null );
			$payment_id = pd_create_invoice( $project, $label, (string) ( $b['kind'] ?? '' ), (int) $amount, pd_date( $b['dueDate'] ?? '' ) );
			if ( is_wp_error( $payment_id ) ) {
				return $payment_id;
			}
			return new WP_REST_Response( array( 'paymentId' => $payment_id ), 201 );
		},
		'pd_can_money'
	);

	pd_route(
		'/payments/(?P<id>\d+)',
		'PATCH',
		static function ( WP_REST_Request $r ) {
			global $wpdb;
			$payment = pd_get_row( 'payments', (int) $r['id'] );
			if ( ! $payment ) {
				return pd_error( 'Payment not found.', 404 );
			}
			$b      = pd_json_body( $r );
			$status = pd_one_of( $b['status'] ?? '', array( 'due', 'paid', 'cancelled' ), '' );
			if ( ! $status ) {
				return pd_error( 'Status must be due, paid or cancelled.' );
			}
			if ( 'paid' === $status ) {
				pd_mark_payment_paid( (int) $payment['id'], pd_text( $b['method'] ?? '', 120 ) ?: 'Bank transfer' );
			} else {
				$wpdb->update( pd_table( 'payments' ), array( 'status' => $status, 'paid_at' => null, 'method' => '' ), array( 'id' => $payment['id'] ) );
			}
			return array( 'ok' => true, 'status' => $status );
		},
		'pd_can_money'
	);

	pd_route(
		'/payments/(?P<id>\d+)/proof',
		'POST',
		static function ( WP_REST_Request $r ) {
			$client_id = pd_client_id_for_user( get_current_user_id() );
			if ( ! $client_id ) {
				return pd_error( 'Only the client can send proof of payment.', 403 );
			}
			$b      = pd_json_body( $r );
			$result = pd_submit_payment_proof( (int) $r['id'], $client_id, (int) ( $b['assetId'] ?? 0 ), pd_textarea( $b['note'] ?? '', 1000 ) );
			return is_wp_error( $result ) ? $result : array( 'ok' => true );
		},
		'pd_can_any'
	);

	pd_route(
		'/documents',
		'POST',
		static function ( WP_REST_Request $r ) {
			$b      = pd_json_body( $r );
			$client = pd_get_row( 'clients', (int) ( $b['clientId'] ?? 0 ) );
			if ( ! $client ) {
				return pd_error( 'Client not found.', 404 );
			}
			$project_id = (int) ( $b['projectId'] ?? 0 );
			if ( $project_id ) {
				$project = pd_get_row( 'projects', $project_id );
				if ( ! $project || (int) $project['client_id'] !== (int) $client['id'] ) {
					return pd_error( 'That project belongs to another client.' );
				}
			}
			$title = pd_text( $b['title'] ?? '', 200 );
			$body  = pd_textarea( $b['body'] ?? '', 50000 );
			if ( ! $title || ! $body ) {
				return pd_error( 'A document needs a title and text.' );
			}
			$id = pd_create_document( (int) $client['id'], $project_id ?: null, $title, $body, (string) ( $b['kind'] ?? 'other' ) );
			pd_notify(
				array(
					array(
						'audience'   => 'client',
						'client_id'  => (int) $client['id'],
						'project_id' => $project_id ?: null,
						'title'      => 'Ready to sign: ' . $title,
						'body'       => "\"{$title}\" is waiting for your signature in the Documents tab.",
						'channels'   => array( 'email' ),
						'email'      => $client['email'],
					),
				)
			);
			return new WP_REST_Response( array( 'documentId' => $id ), 201 );
		},
		'pd_can_staff'
	);

	pd_route(
		'/documents/(?P<id>\d+)',
		'PATCH',
		static function ( WP_REST_Request $r ) {
			global $wpdb;
			$doc = pd_get_row( 'documents', (int) $r['id'] );
			if ( ! $doc ) {
				return pd_error( 'Document not found.', 404 );
			}
			if ( 'signed' === $doc['status'] ) {
				return pd_error( 'A signed document cannot be changed. Send a new one instead.', 409 );
			}
			$b     = pd_json_body( $r );
			$title = pd_text( $b['title'] ?? $doc['title'], 200 );
			$body  = isset( $b['body'] ) ? pd_textarea( $b['body'], 50000 ) : $doc['body'];
			if ( ! $title || ! $body ) {
				return pd_error( 'A document needs a title and text.' );
			}
			$wpdb->update( pd_table( 'documents' ), array( 'title' => $title, 'body' => $body, 'body_hash' => hash( 'sha256', $body ) ), array( 'id' => $doc['id'] ) );
			return array( 'ok' => true );
		},
		'pd_can_staff'
	);

	pd_route(
		'/notifications/read',
		'POST',
		static function () {
			global $wpdb;
			if ( pd_can_staff() ) {
				$wpdb->query( $wpdb->prepare( 'UPDATE ' . pd_table( 'notifications' ) . " SET read_at = %s WHERE audience = 'staff' AND read_at IS NULL", pd_now() ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			} else {
				$wpdb->query( $wpdb->prepare( 'UPDATE ' . pd_table( 'notifications' ) . " SET read_at = %s WHERE audience = 'client' AND client_id = %d AND read_at IS NULL", pd_now(), pd_client_id_for_user( get_current_user_id() ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			}
			return array( 'ok' => true );
		},
		'pd_can_any'
	);

	/* --------------------------------------------------- owner: settings/staff */

	pd_route(
		'/settings',
		'GET',
		static function () {
			$s = pd_settings();
			return array(
				'businessName'    => $s['business_name'],
				'brandColor'      => $s['brand_color'],
				'logoUrl'         => $s['logo_url'],
				'currency'        => $s['currency'],
				'portalUrl'       => $s['portal_url'],
				'staffAlertEmail' => $s['staff_alert_email'],
				'googleClientId'  => $s['google_client_id'],
				'maxUploadMb'     => (int) $s['max_upload_mb'],
				'services'        => $s['services'],
				'agreement'       => $s['agreement'],
				'legalName'       => $s['legal_name'],
				'rcNumber'        => $s['rc_number'],
				'businessEmail'   => $s['business_email'],
				'businessPhone'   => $s['business_phone'],
				'businessAddress' => $s['business_address'],
				'businessWebsite' => $s['business_website'],
				'tagline'         => $s['tagline'],
				'emailLogoUrl'    => $s['email_logo_url'],
				'emailLogoDefault' => pd_default_email_logo(),
				'depositPercent'  => (int) $s['deposit_percent'],
				'invoiceDueDays'  => (int) $s['invoice_due_days'],
				'bankDetails'     => $s['bank_details'],
				'invoiceVat'      => (bool) $s['invoice_vat'],
				'invoiceNaija'    => pd_invoicenaija_active(),
				'setupComplete'   => (bool) $s['setup_complete'],
			);
		},
		'pd_can_settings'
	);
	pd_route(
		'/settings',
		'PUT',
		static function ( WP_REST_Request $r ) {
			$result = pd_update_settings( pd_json_body( $r ) );
			return is_wp_error( $result ) ? $result : array( 'ok' => true );
		},
		'pd_can_settings'
	);

	pd_route(
		'/staff',
		'GET',
		static function () {
			$users = get_users( array( 'role__in' => array( 'pd_owner', 'pd_manager', 'administrator' ) ) );
			return array_map(
				static fn( WP_User $u ) => array(
					'id'    => $u->ID,
					'name'  => $u->display_name,
					'email' => $u->user_email,
					'role'  => user_can( $u, 'pd_manage_settings' ) ? 'owner' : 'manager',
				),
				$users
			);
		},
		'pd_can_manage_staff'
	);
	pd_route(
		'/staff',
		'POST',
		static function ( WP_REST_Request $r ) {
			$b    = pd_json_body( $r );
			$role = 'owner' === ( $b['role'] ?? '' ) ? 'pd_owner' : 'pd_manager';
			$id   = pd_invite_user( (string) ( $b['email'] ?? '' ), pd_text( $b['name'] ?? '', 160 ), $role );
			if ( is_wp_error( $id ) ) {
				return $id;
			}
			if ( pd_client_id_for_user( $id ) ) {
				return pd_error( 'That email belongs to a client. Use a different email for staff.', 409 );
			}
			return new WP_REST_Response( array( 'userId' => $id ), 201 );
		},
		'pd_can_manage_staff'
	);

	/* ---------------------------------------------------------- client portal */

	pd_route(
		'/portal',
		'GET',
		static function ( WP_REST_Request $r ) {
			global $wpdb;
			$client_id = pd_can_staff() ? (int) $r->get_param( 'clientId' ) : pd_client_id_for_user( get_current_user_id() );
			$client    = $client_id ? pd_get_row( 'clients', $client_id ) : null;
			if ( ! $client ) {
				return pd_error( 'Client not found.', 404 );
			}
			return array(
				'preview'       => pd_can_staff(),
				'client'        => pd_map_client( $client ),
				'projects'      => pd_load_projects( $client_id, false ),
				'documents'     => pd_load_documents( $client_id, true ),
				'notifications' => pd_load_notifications( 'client', $client_id ),
			);
		},
		'pd_can_any'
	);

	// Resumable uploads for clients and staff: start, send pieces, finish.
	pd_route(
		'/projects/(?P<id>\d+)/uploads',
		'POST',
		static function ( WP_REST_Request $r ) {
			$project = pd_project_for_current_user( (int) $r['id'] );
			if ( ! $project ) {
				return pd_error( 'Project not found.', 404 );
			}
			$b        = pd_json_body( $r );
			$replaces = (int) ( $b['replaces'] ?? 0 );
			if ( $replaces ) {
				$old = pd_get_row( 'assets', $replaces );
				if ( ! $old || (int) $old['project_id'] !== (int) $project['id'] ) {
					return pd_error( 'The file you are replacing is not in this project.' );
				}
			}
			$session = pd_upload_start( get_current_user_id(), $project, (string) ( $b['name'] ?? '' ), (int) ( $b['size'] ?? 0 ), (string) ( $b['category'] ?? '' ), $replaces );
			return is_wp_error( $session ) ? $session : new WP_REST_Response( array( 'uploadId' => $session['id'], 'chunkBytes' => PD_CHUNK_BYTES, 'received' => 0 ), 201 );
		},
		'pd_can_any'
	);
	pd_route(
		'/uploads/(?P<upload>[0-9a-f-]{36})',
		'PUT',
		static function ( WP_REST_Request $r ) {
			$session = pd_upload_session( (string) $r['upload'], get_current_user_id() );
			if ( is_wp_error( $session ) ) {
				return $session;
			}
			$session = pd_upload_chunk( $session, (int) $r->get_param( 'offset' ), (string) $r->get_body() );
			return is_wp_error( $session ) ? $session : array( 'received' => $session['received'] );
		},
		'pd_can_any'
	);
	pd_route(
		'/uploads/(?P<upload>[0-9a-f-]{36})',
		'GET',
		static function ( WP_REST_Request $r ) {
			$session = pd_upload_session( (string) $r['upload'], get_current_user_id() );
			return is_wp_error( $session ) ? $session : array( 'received' => $session['received'], 'size' => $session['size'] );
		},
		'pd_can_any'
	);
	pd_route(
		'/uploads/(?P<upload>[0-9a-f-]{36})/finish',
		'POST',
		static function ( WP_REST_Request $r ) {
			global $wpdb;
			$session = pd_upload_session( (string) $r['upload'], get_current_user_id() );
			if ( is_wp_error( $session ) ) {
				return $session;
			}
			$file = pd_upload_finish( $session );
			if ( is_wp_error( $file ) ) {
				return $file;
			}
			$staff = pd_can_staff();
			$user  = wp_get_current_user();
			$wpdb->insert(
				pd_table( 'assets' ),
				array(
					'project_id'       => $session['project_id'],
					'client_id'        => $session['client_id'],
					'category'         => $session['category'],
					'name'             => $session['name'],
					'kind'             => $file['kind'],
					'size'             => $file['size'],
					'mime'             => $file['mime'],
					'storage_key'      => $file['storage_key'],
					'status'           => $staff ? 'accepted' : 'pending',
					'version_of'       => $session['replaces'] ?: null,
					'uploaded_by'      => $user->ID,
					'uploaded_by_name' => $user->display_name,
					'created_at'       => pd_now(),
				)
			);
			$asset_id = (int) $wpdb->insert_id;
			if ( 'payments' === $session['category'] ) {
				// Proof of payment: the proof route tells the team, with the invoice it belongs to.
				return new WP_REST_Response( array( 'assetId' => $asset_id ), 201 );
			}
			$project  = pd_get_row( 'projects', (int) $session['project_id'] );
			$client   = pd_get_row( 'clients', (int) $session['client_id'] );
			pd_notify(
				array(
					$staff
						? array(
							'audience'   => 'client',
							'client_id'  => (int) $session['client_id'],
							'project_id' => (int) $session['project_id'],
							'title'      => "New file from the team: {$session['name']}",
							'body'       => "{$user->display_name} shared \"{$session['name']}\" on {$project['name']}.",
							'channels'   => array( 'email' ),
							'email'      => $client['email'] ?? '',
						)
						: array(
							'audience'   => 'staff',
							'client_id'  => (int) $session['client_id'],
							'project_id' => (int) $session['project_id'],
							'title'      => "New upload to review — {$project['name']}",
							'body'       => "{$user->display_name} uploaded \"{$session['name']}\" to {$session['category']}.",
							'channels'   => array( 'email', 'whatsapp' ),
						),
				)
			);
			return new WP_REST_Response( array( 'assetId' => $asset_id ), 201 );
		},
		'pd_can_any'
	);

	pd_route(
		'/projects/(?P<id>\d+)/notes',
		'POST',
		static function ( WP_REST_Request $r ) {
			global $wpdb;
			$project = pd_project_for_current_user( (int) $r['id'] );
			if ( ! $project ) {
				return pd_error( 'Project not found.', 404 );
			}
			$b     = pd_json_body( $r );
			$title = pd_text( $b['title'] ?? '', 200 );
			$body  = pd_textarea( $b['body'] ?? '', 20000 );
			if ( ! $title || mb_strlen( $body ) < 2 ) {
				return pd_error( 'Give the note a title and some text.' );
			}
			$user  = wp_get_current_user();
			$staff = pd_can_staff();
			$wpdb->insert(
				pd_table( 'assets' ),
				array(
					'project_id'       => $project['id'],
					'client_id'        => $project['client_id'],
					'category'         => pd_one_of( $b['category'] ?? 'notes', pd_settings()['asset_categories'], 'notes' ),
					'name'             => $title,
					'kind'             => 'note',
					'size'             => strlen( $body ),
					'mime'             => 'text/plain',
					'body'             => $body,
					'status'           => $staff ? 'accepted' : 'pending',
					'uploaded_by'      => $user->ID,
					'uploaded_by_name' => $user->display_name,
					'created_at'       => pd_now(),
				)
			);
			$asset_id = (int) $wpdb->insert_id;
			if ( ! $staff ) {
				pd_notify(
					array(
						array(
							'audience'   => 'staff',
							'client_id'  => (int) $project['client_id'],
							'project_id' => (int) $project['id'],
							'title'      => "New note to review — {$project['name']}",
							'body'       => "{$user->display_name} sent \"{$title}\".",
							'channels'   => array( 'email' ),
						),
					)
				);
			}
			return new WP_REST_Response( array( 'assetId' => $asset_id ), 201 );
		},
		'pd_can_any'
	);

	pd_route(
		'/files/(?P<id>\d+)',
		'GET',
		static function ( WP_REST_Request $r ) {
			$asset = pd_get_row( 'assets', (int) $r['id'] );
			if ( ! $asset || ! $asset['storage_key'] || ! pd_project_for_current_user( (int) $asset['project_id'] ) ) {
				return pd_error( 'File not found.', 404 );
			}
			pd_send_file( $asset );
		},
		'pd_can_any'
	);

	pd_route(
		'/documents/(?P<id>\d+)/sign',
		'POST',
		static function ( WP_REST_Request $r ) {
			$b      = pd_json_body( $r );
			$result = pd_sign_document(
				(int) $r['id'],
				pd_client_id_for_user( get_current_user_id() ),
				get_current_user_id(),
				pd_text( $b['name'] ?? '', 160 ),
				is_string( $b['signature'] ?? null ) ? $b['signature'] : '',
				! empty( $b['agree'] )
			);
			return is_wp_error( $result ) ? $result : array( 'ok' => true, 'signedAt' => $result );
		},
		'pd_can_client'
	);

	pd_route(
		'/phases/(?P<id>\d+)/approve',
		'POST',
		static function ( WP_REST_Request $r ) {
			$result = pd_approve_phase( (int) $r['id'], pd_client_id_for_user( get_current_user_id() ), get_current_user_id(), pd_textarea( pd_json_body( $r )['note'] ?? '', 2000 ) );
			return is_wp_error( $result ) ? $result : array( 'ok' => true );
		},
		'pd_can_client'
	);

	pd_route(
		'/projects/(?P<id>\d+)/reviews',
		'POST',
		static function ( WP_REST_Request $r ) {
			global $wpdb;
			$project = pd_project_for_current_user( (int) $r['id'] );
			if ( ! $project ) {
				return pd_error( 'Project not found.', 404 );
			}
			$b      = pd_json_body( $r );
			$rating = (int) ( $b['rating'] ?? 0 );
			$body   = pd_textarea( $b['body'] ?? '', 4000 );
			if ( $rating < 1 || $rating > 5 ) {
				return pd_error( 'Choose a rating from 1 to 5.' );
			}
			if ( mb_strlen( $body ) < 10 ) {
				return pd_error( 'Write at least a sentence.' );
			}
			$user = wp_get_current_user();
			$wpdb->insert(
				pd_table( 'reviews' ),
				array(
					'project_id'  => $project['id'],
					'client_id'   => $project['client_id'],
					'milestone'   => pd_text( $b['milestone'] ?? '', 160 ),
					'rating'      => $rating,
					'body'        => $body,
					'author_name' => $user->display_name,
					'created_at'  => pd_now(),
				)
			);
			pd_notify(
				array(
					array(
						'audience'   => 'staff',
						'client_id'  => (int) $project['client_id'],
						'project_id' => (int) $project['id'],
						'title'      => "New {$rating}-star review — {$project['name']}",
						'body'       => $body,
						'channels'   => array( 'email', 'whatsapp' ),
					),
				)
			);
			return new WP_REST_Response( array( 'ok' => true ), 201 );
		},
		'pd_can_client'
	);

	pd_route(
		'/projects/(?P<id>\d+)/messages',
		'POST',
		static function ( WP_REST_Request $r ) {
			global $wpdb;
			$project = pd_project_for_current_user( (int) $r['id'] );
			if ( ! $project ) {
				return pd_error( 'Project not found.', 404 );
			}
			$body = pd_textarea( pd_json_body( $r )['body'] ?? '', 5000 );
			if ( ! $body ) {
				return pd_error( 'Write a message first.' );
			}
			$staff = pd_can_staff();
			$user  = wp_get_current_user();
			$wpdb->insert(
				pd_table( 'messages' ),
				array(
					'project_id'  => $project['id'],
					'author_id'   => $user->ID,
					'author_role' => $staff ? 'staff' : 'client',
					'author_name' => $user->display_name,
					'body'        => $body,
					'created_at'  => pd_now(),
				)
			);
			$message_id = (int) $wpdb->insert_id;
			$client     = pd_get_row( 'clients', (int) $project['client_id'] );
			pd_notify(
				array(
					array(
						'audience'   => $staff ? 'client' : 'staff',
						'client_id'  => (int) $project['client_id'],
						'project_id' => (int) $project['id'],
						'title'      => "New message from {$user->display_name} — {$project['name']}",
						'body'       => $body,
						'channels'   => array( 'email' ),
						'email'      => $client['email'] ?? '',
					),
				)
			);
			return new WP_REST_Response( array( 'messageId' => $message_id ), 201 );
		},
		'pd_can_any'
	);
}
