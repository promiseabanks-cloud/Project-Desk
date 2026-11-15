<?php
/**
 * Business rules: onboarding, phases and their gates, agreements, and loading records for the
 * console and the portal.
 *
 * @package Project_Desk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/* ------------------------------------------------------------------ loading */

function pd_get_row( string $table, int $id ): ?array {
	global $wpdb;
	$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . pd_table( $table ) . ' WHERE id = %d', $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	return $row ? $row : null;
}

/** Rows of $table whose $column is one of $ids. */
function pd_rows_in( string $table, string $column, array $ids, string $order = 'id ASC' ): array {
	global $wpdb;
	$ids = array_values( array_filter( array_map( 'intval', $ids ) ) );
	if ( ! $ids ) {
		return array();
	}
	$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
	// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	return $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . pd_table( $table ) . " WHERE {$column} IN ({$placeholders}) ORDER BY {$order}", $ids ), ARRAY_A );
}

function pd_iso( ?string $mysql ): ?string {
	return $mysql ? gmdate( 'c', strtotime( $mysql . ' UTC' ) ) : null;
}

function pd_map_client( array $r ): array {
	return array(
		'id'          => (int) $r['id'],
		'company'     => $r['company'],
		'contactName' => $r['contact_name'],
		'email'       => $r['email'],
		'phone'       => $r['phone'],
		'website'     => $r['website'],
		'industry'    => $r['industry'],
		'status'      => $r['status'],
		'notes'       => (string) $r['notes'],
		'hasAccount'  => (bool) $r['user_id'],
		'briefId'     => $r['brief_id'] ? (int) $r['brief_id'] : null,
		'createdAt'   => pd_iso( $r['created_at'] ),
	);
}

function pd_map_asset( array $r, bool $staff ): array {
	return array(
		'id'         => (int) $r['id'],
		'projectId'  => (int) $r['project_id'],
		'category'   => $r['category'],
		'name'       => $r['name'],
		'kind'       => $r['kind'],
		'size'       => (int) $r['size'],
		'mime'       => $r['mime'],
		'hasFile'    => (bool) $r['storage_key'],
		'body'       => 'note' === $r['kind'] ? (string) $r['body'] : null,
		'status'     => $r['status'],
		'reviewNote' => (string) $r['review_note'],
		'versionOf'  => $r['version_of'] ? (int) $r['version_of'] : null,
		'uploadedBy' => $r['uploaded_by_name'],
		'fromStaff'  => $r['uploaded_by'] ? pd_is_staff( (int) $r['uploaded_by'] ) : false,
		'createdAt'  => pd_iso( $r['created_at'] ),
		'reviewedAt' => pd_iso( $r['reviewed_at'] ),
	);
}

function pd_map_document( array $r, bool $with_signature = false ): array {
	$out = array(
		'id'            => (int) $r['id'],
		'clientId'      => (int) $r['client_id'],
		'projectId'     => $r['project_id'] ? (int) $r['project_id'] : null,
		'title'         => $r['title'],
		'kind'          => $r['kind'],
		'body'          => $r['body'],
		'bodyHash'      => $r['body_hash'],
		'status'        => $r['status'],
		'signatureName' => $r['signature_name'],
		'signedAt'      => pd_iso( $r['signed_at'] ),
		'createdAt'     => pd_iso( $r['created_at'] ),
	);
	if ( $with_signature && 'signed' === $r['status'] ) {
		$out['signatureImage'] = $r['signature_image'];
		$out['signerIp']       = $r['signer_ip'];
		$out['signerAgent']    = $r['signer_agent'];
	}
	return $out;
}

function pd_payment_state( array $r ): string {
	if ( 'due' === $r['status'] && $r['due_date'] && $r['due_date'] < gmdate( 'Y-m-d' ) ) {
		return 'overdue';
	}
	return $r['status'];
}

/**
 * Projects with everything attached. $client_id 0 = all clients (staff console).
 */
function pd_load_projects( int $client_id, bool $staff ): array {
	global $wpdb;
	$sql      = 'SELECT * FROM ' . pd_table( 'projects' ) . ( $client_id ? $wpdb->prepare( ' WHERE client_id = %d', $client_id ) : '' ) . ' ORDER BY created_at DESC, id DESC';
	$projects = $wpdb->get_results( $sql, ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	$ids      = array_column( $projects, 'id' );
	$group    = static function ( array $rows ) {
		$out = array();
		foreach ( $rows as $row ) {
			$out[ (int) $row['project_id'] ][] = $row;
		}
		return $out;
	};
	$phases   = $group( pd_rows_in( 'phases', 'project_id', $ids, 'position ASC, id ASC' ) );
	$assets   = $group( pd_rows_in( 'assets', 'project_id', $ids, 'created_at DESC, id DESC' ) );
	$payments = $group( pd_rows_in( 'payments', 'project_id', $ids, 'due_date ASC, id ASC' ) );
	$messages = $group( pd_rows_in( 'messages', 'project_id', $ids, 'created_at ASC, id ASC' ) );
	$reviews  = $group( pd_rows_in( 'reviews', 'project_id', $ids, 'created_at DESC' ) );
	$services = pd_settings()['services'];

	return array_map(
		static function ( $p ) use ( $phases, $assets, $payments, $messages, $reviews, $services, $staff ) {
			$pid  = (int) $p['id'];
			$ph   = $phases[ $pid ] ?? array();
			$done = count( array_filter( $ph, static fn( $x ) => 'completed' === $x['status'] ) );
			return array(
				'id'           => $pid,
				'clientId'     => (int) $p['client_id'],
				'name'         => $p['name'],
				'service'      => $p['service'],
				'serviceLabel' => $services[ $p['service'] ]['label'] ?? $p['service'],
				'summary'      => (string) $p['summary'],
				'status'       => $p['status'],
				'recurring'    => (bool) $p['recurring'],
				'startDate'    => $p['start_date'],
				'dueDate'      => $p['due_date'],
				'progress'     => $ph ? (int) round( 100 * $done / count( $ph ) ) : 0,
				'workUnlocked' => pd_work_unlocked( $pid ),
				'price'        => (int) $p['price'],
				'depositPercent' => (int) $p['deposit_percent'],
				'phases'       => array_map(
					static fn( $x ) => array(
						'id'           => (int) $x['id'],
						'name'         => $x['name'],
						'position'     => (int) $x['position'],
						'stage'        => $x['stage'],
						'signoff'      => (bool) $x['signoff'],
						'billPercent'  => (int) $x['bill_percent'],
						'status'       => $x['status'],
						'note'         => (string) $x['note'],
						'approvedAt'   => pd_iso( $x['approved_at'] ),
						'approvalNote' => (string) $x['approval_note'],
						'startedAt'    => pd_iso( $x['started_at'] ),
						'completedAt'  => pd_iso( $x['completed_at'] ),
					),
					$ph
				),
				'assets'       => array_map( static fn( $a ) => pd_map_asset( $a, $staff ), $assets[ $pid ] ?? array() ),
				'payments'     => array_map(
					static fn( $x ) => array(
						'id'       => (int) $x['id'],
						'label'    => $x['label'],
						'kind'     => $x['kind'],
						'amount'   => (int) $x['amount'],
						'currency' => $x['currency'],
						'dueDate'  => $x['due_date'],
						'status'   => pd_payment_state( $x ),
						'paidAt'   => pd_iso( $x['paid_at'] ),
						'method'   => $x['method'],
						'externalUrl'  => (string) $x['external_url'],
						'proofAt'      => pd_iso( $x['proof_at'] ),
						'proofAssetId' => $x['proof_asset_id'] ? (int) $x['proof_asset_id'] : null,
						'proofNote'    => (string) $x['proof_note'],
						'phaseId'      => $x['phase_id'] ? (int) $x['phase_id'] : null,
					),
					$payments[ $pid ] ?? array()
				),
				'messages'     => array_map(
					static fn( $m ) => array(
						'id'         => (int) $m['id'],
						'authorRole' => $m['author_role'],
						'authorName' => $m['author_name'],
						'body'       => $m['body'],
						'createdAt'  => pd_iso( $m['created_at'] ),
					),
					$messages[ $pid ] ?? array()
				),
				'reviews'      => array_map(
					static fn( $r ) => array(
						'id'         => (int) $r['id'],
						'milestone'  => $r['milestone'],
						'rating'     => (int) $r['rating'],
						'body'       => $r['body'],
						'authorName' => $r['author_name'],
						'createdAt'  => pd_iso( $r['created_at'] ),
					),
					$reviews[ $pid ] ?? array()
				),
			);
		},
		$projects
	);
}

function pd_load_documents( int $client_id, bool $with_signature ): array {
	global $wpdb;
	$sql = 'SELECT * FROM ' . pd_table( 'documents' ) . ( $client_id ? $wpdb->prepare( ' WHERE client_id = %d', $client_id ) : '' ) . ' ORDER BY created_at DESC, id DESC';
	return array_map( static fn( $r ) => pd_map_document( $r, $with_signature ), $wpdb->get_results( $sql, ARRAY_A ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
}

function pd_load_notifications( string $audience, int $client_id = 0, int $limit = 100 ): array {
	global $wpdb;
	$where = $wpdb->prepare( 'audience = %s', $audience ) . ( $client_id ? $wpdb->prepare( ' AND client_id = %d', $client_id ) : '' ) . " AND channel = 'in_app'";
	// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$rows = $wpdb->get_results( 'SELECT * FROM ' . pd_table( 'notifications' ) . " WHERE {$where} ORDER BY id DESC LIMIT " . (int) $limit, ARRAY_A );
	return array_map(
		static fn( $n ) => array(
			'id'        => (int) $n['id'],
			'projectId' => $n['project_id'] ? (int) $n['project_id'] : null,
			'title'     => $n['title'],
			'body'      => $n['body'],
			'createdAt' => pd_iso( $n['created_at'] ),
			'read'      => (bool) $n['read_at'],
		),
		$rows
	);
}

/* --------------------------------------------------------------- onboarding */

/** Creates a project with the opening phases and the service's work phases. */
function pd_create_project( int $client_id, string $name, string $service, string $summary = '', ?string $due = null, ?int $manager_id = null, int $price = 0, ?int $deposit_percent = null, array $bills = array() ) {
	global $wpdb;
	$services = pd_settings()['services'];
	if ( ! isset( $services[ $service ] ) ) {
		return pd_error( 'Choose one of the services in settings.' );
	}
	$wpdb->insert(
		pd_table( 'projects' ),
		array(
			'client_id'  => $client_id,
			'name'       => $name,
			'service'    => $service,
			'summary'    => $summary,
			'status'     => 'active',
			'recurring'  => $services[ $service ]['recurring'] ? 1 : 0,
			'manager_id' => $manager_id,
			'start_date' => gmdate( 'Y-m-d' ),
			'due_date'   => $due,
			'price'      => max( 0, $price ),
			'deposit_percent' => max( 0, min( 100, null === $deposit_percent ? (int) pd_settings()['deposit_percent'] : $deposit_percent ) ),
			'created_at' => pd_now(),
		)
	);
	$project_id = (int) $wpdb->insert_id;
	$open_count = count( pd_opening_phases() );
	$phases     = array_merge(
		pd_opening_phases(),
		array_map( static fn( $p ) => $p + array( 'stage' => 'work' ), $services[ $service ]['phases'] )
	);
	foreach ( $phases as $i => $p ) {
		if ( 'work' === ( $p['stage'] ?? '' ) ) {
			$work_index = $i - $open_count;
			if ( isset( $bills[ $work_index ] ) ) {
				$p['bill'] = max( 0, min( 100, (int) $bills[ $work_index ] ) );
			}
		}
		$wpdb->insert(
			pd_table( 'phases' ),
			array(
				'project_id' => $project_id,
				'name'       => $p['name'],
				'position'   => $i,
				'stage'      => $p['stage'],
				'signoff'    => ! empty( $p['signoff'] ) ? 1 : 0,
				'bill_percent' => isset( $p['bill'] ) ? max( 0, min( 100, (int) $p['bill'] ) ) : 0,
				'status'     => 0 === $i ? 'completed' : ( 1 === $i ? 'ongoing' : 'queued' ),
				'started_at' => $i < 2 ? pd_now() : null,
				'completed_at' => 0 === $i ? pd_now() : null,
			)
		);
	}
	return $project_id;
}

/**
 * Price (kobo) and deposit % from an onboarding or project form. Only people who manage money
 * can set them; for everyone else they stay at no price and the default deposit.
 *
 * @return array{0:int,1:?int}
 */
function pd_price_input( array $in ): array {
	if ( ! current_user_can( 'pd_manage_money' ) ) {
		return array( 0, null );
	}
	$price = isset( $in['price'] ) && '' !== $in['price'] ? (int) pd_money( $in['price'] ) : 0;
	$pct   = isset( $in['depositPercent'] ) && '' !== $in['depositPercent'] ? max( 0, min( 100, (int) $in['depositPercent'] ) ) : null;
	return array( $price, $pct );
}

/**
 * Payment-milestone percentages from a form, as work-phase index => percent (1-100). Only people
 * who manage money may set them; the key is the phase's position within the service's work phases.
 */
function pd_milestones_input( array $in ): array {
	if ( ! current_user_can( 'pd_manage_money' ) || empty( $in['milestones'] ) || ! is_array( $in['milestones'] ) ) {
		return array();
	}
	$out = array();
	foreach ( $in['milestones'] as $index => $percent ) {
		$pct = max( 0, min( 100, (int) $percent ) );
		if ( $pct > 0 ) {
			$out[ (int) $index ] = $pct;
		}
	}
	return $out;
}

/** Creates an agreement awaiting signature. */
function pd_create_document( int $client_id, ?int $project_id, string $title, string $body, string $kind = 'agreement' ): int {
	global $wpdb;
	$wpdb->insert(
		pd_table( 'documents' ),
		array(
			'client_id'  => $client_id,
			'project_id' => $project_id,
			'title'      => $title,
			'kind'       => pd_one_of( $kind, array( 'agreement', 'sow', 'nda', 'retainer', 'other' ), 'agreement' ),
			'body'       => $body,
			'body_hash'  => hash( 'sha256', $body ),
			'status'     => 'awaiting_signature',
			'created_at' => pd_now(),
		)
	);
	return (int) $wpdb->insert_id;
}

/**
 * Onboards a client in one step: client record, portal account and invite, first project with
 * phases, and the agreement to sign.
 */
function pd_onboard_client( array $in ) {
	global $wpdb;
	$company = pd_text( $in['company'] ?? '', 160 );
	$contact = pd_text( $in['contactName'] ?? '', 160 );
	$email   = strtolower( sanitize_email( (string) ( $in['email'] ?? '' ) ) );
	$service = sanitize_key( (string) ( $in['service'] ?? 'website' ) );
	$svcs    = pd_settings()['services'];
	if ( ! $company ) {
		return pd_error( 'A company name is required.' );
	}
	if ( ! $contact ) {
		return pd_error( 'A primary contact name is required.' );
	}
	if ( ! is_email( $email ) ) {
		return pd_error( 'Enter a valid contact email address.' );
	}
	if ( ! isset( $svcs[ $service ] ) ) {
		return pd_error( 'Choose one of the services in settings.' );
	}
	if ( $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . pd_table( 'clients' ) . ' WHERE email = %s', $email ) ) ) { // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return pd_error( 'A client with that contact email already exists.', 409 );
	}
	$user_id = pd_invite_user( $email, $contact, 'pd_client' );
	if ( is_wp_error( $user_id ) ) {
		return $user_id;
	}
	$wpdb->insert(
		pd_table( 'clients' ),
		array(
			'user_id'      => $user_id,
			'company'      => $company,
			'contact_name' => $contact,
			'email'        => $email,
			'phone'        => pd_text( $in['phone'] ?? '', 40 ),
			'website'      => esc_url_raw( (string) ( $in['website'] ?? '' ) ),
			'industry'     => pd_text( $in['industry'] ?? '', 80 ),
			'status'       => 'onboarding',
			'notes'        => pd_textarea( $in['notes'] ?? '', 4000 ),
			'brief_id'     => ! empty( $in['briefId'] ) ? (int) $in['briefId'] : null,
			'created_at'   => pd_now(),
		)
	);
	$client_id  = (int) $wpdb->insert_id;
	$label      = $svcs[ $service ]['label'];
	$name       = pd_text( $in['projectName'] ?? '', 160 ) ?: $company . ' — ' . $label;
	[ $price, $pct ] = pd_price_input( $in );
	$bills           = pd_milestones_input( $in );
	$project_id      = pd_create_project( $client_id, $name, $service, pd_textarea( $in['summary'] ?? '', 2000 ), pd_date( $in['dueDate'] ?? '' ), null, $price, $pct, $bills );
	$pct             = (int) pd_get_row( 'projects', $project_id )['deposit_percent'];
	$doc_id          = pd_create_document( $client_id, $project_id, 'Service agreement — ' . $label, pd_agreement_text( $company, $label, $price, $pct ) );

	$s = pd_settings();
	pd_notify(
		array(
			array(
				'audience'   => 'client',
				'client_id'  => $client_id,
				'project_id' => $project_id,
				'title'      => sprintf( 'Welcome to %s, %s', $s['business_name'], $company ),
				'body'       => $price > 0
					? sprintf( 'Your service agreement is ready to sign in the Documents tab. Once you sign it, your %d%% deposit invoice (%s) is sent to you, and work starts when it is paid.', $pct, pd_format_money( (int) round( $price * $pct / 100 ) ) )
					: 'Your service agreement is ready to sign in the Documents tab. Work starts once it is signed and the deposit is paid.',
				'channels'   => array(),
			),
		)
	);
	return array( 'clientId' => $client_id, 'projectId' => $project_id, 'documentId' => $doc_id, 'userId' => $user_id );
}

/* ------------------------------------------------------------------- phases */

/** True when the agreement for the project's client is signed and a deposit for the project is paid. */
function pd_work_unlocked( int $project_id ): bool {
	global $wpdb;
	$project = pd_get_row( 'projects', $project_id );
	if ( ! $project ) {
		return false;
	}
	$signed = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . pd_table( 'documents' ) . " WHERE client_id = %d AND (project_id = %d OR project_id IS NULL) AND kind = 'agreement' AND status = 'signed'", $project['client_id'], $project_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	$paid   = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . pd_table( 'payments' ) . " WHERE project_id = %d AND kind = 'deposit' AND status = 'paid'", $project_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	return $signed > 0 && $paid > 0;
}

/**
 * When the agreement is signed and the deposit paid, closes the opening phases and starts the
 * first work phase. Safe to call any time.
 */
function pd_maybe_unlock_work( int $project_id ): void {
	global $wpdb;
	if ( ! pd_work_unlocked( $project_id ) ) {
		return;
	}
	$t      = pd_table( 'phases' );
	$opened = (int) $wpdb->query( $wpdb->prepare( "UPDATE {$t} SET status = 'completed', started_at = COALESCE(started_at, %s), completed_at = COALESCE(completed_at, %s) WHERE project_id = %d AND stage = 'opening' AND status != 'completed'", pd_now(), pd_now(), $project_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	if ( ! $opened ) {
		return;
	}
	$first = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE project_id = %d AND stage = 'work' ORDER BY position ASC LIMIT 1", $project_id ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	if ( $first && 'queued' === $first['status'] ) {
		$wpdb->update( $t, array( 'status' => 'ongoing', 'started_at' => pd_now() ), array( 'id' => $first['id'] ) );
	}
	$project = pd_get_row( 'projects', $project_id );
	$client  = pd_get_row( 'clients', (int) $project['client_id'] );
	$wpdb->update( pd_table( 'clients' ), array( 'status' => 'active' ), array( 'id' => $project['client_id'], 'status' => 'onboarding' ) );
	pd_notify(
		array(
			array(
				'audience'   => 'client',
				'client_id'  => (int) $project['client_id'],
				'project_id' => $project_id,
				'title'      => 'Your project has started — ' . $project['name'],
				'body'       => $first ? 'Agreement signed and deposit received. First up: ' . $first['name'] . '.' : 'Agreement signed and deposit received.',
				'channels'   => array( 'email' ),
				'email'      => $client['email'] ?? '',
			),
			array(
				'audience'   => 'staff',
				'client_id'  => (int) $project['client_id'],
				'project_id' => $project_id,
				'title'      => 'Ready to start — ' . $project['name'],
				'body'       => 'Agreement signed and deposit paid. The first work phase is now in progress.',
				'channels'   => array( 'email' ),
			),
		)
	);
}

/**
 * Changes a phase's status, enforcing the rules:
 * - work phases cannot start before the agreement is signed and the deposit paid;
 * - a phase that needs client sign-off cannot be completed before the client approves;
 * - only one phase is in progress; starting a later one completes earlier ones.
 * Owners may override the first two with $override.
 */
function pd_set_phase_status( int $phase_id, string $status, string $note, bool $override ) {
	global $wpdb;
	$t     = pd_table( 'phases' );
	$phase = pd_get_row( 'phases', $phase_id );
	if ( ! $phase ) {
		return pd_error( 'Phase not found.', 404 );
	}
	$status     = pd_one_of( $status, array( 'queued', 'ongoing', 'completed' ), '' );
	$project_id = (int) $phase['project_id'];
	if ( ! $status ) {
		return pd_error( 'Status must be queued, ongoing or completed.' );
	}
	if ( 'queued' !== $status && 'work' === $phase['stage'] && ! pd_work_unlocked( $project_id ) && ! $override ) {
		return pd_error( 'Work starts once the agreement is signed and the deposit is paid.', 409, 'pd_gate_unpaid' );
	}
	if ( 'queued' !== $status && 'work' === $phase['stage'] && ! $override ) {
		$milestone = pd_milestone_blocks_phase( $project_id, (int) $phase['position'] );
		if ( $milestone ) {
			return pd_error( sprintf( 'The invoice for "%s" must be paid before this phase can go ahead.', $milestone ), 409, 'pd_gate_unpaid' );
		}
	}
	if ( 'completed' === $status && $phase['signoff'] && ! $phase['approved_at'] && ! $override ) {
		return pd_error( 'This phase needs the client\'s approval before it can be completed.', 409, 'pd_gate_signoff' );
	}
	// Earlier phases that would be auto-completed must not skip a pending client approval.
	if ( 'queued' !== $status && ! $override ) {
		$blocked = $wpdb->get_var( $wpdb->prepare( "SELECT name FROM {$t} WHERE project_id = %d AND position < %d AND status != 'completed' AND signoff = 1 AND approved_at IS NULL LIMIT 1", $project_id, $phase['position'] ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( $blocked ) {
			return pd_error( sprintf( '"%s" is still waiting for the client\'s approval.', $blocked ), 409, 'pd_gate_signoff' );
		}
	}
	$now = pd_now();
	if ( 'queued' !== $status ) {
		$wpdb->query( $wpdb->prepare( "UPDATE {$t} SET status = 'completed', started_at = COALESCE(started_at, %s), completed_at = COALESCE(completed_at, %s) WHERE project_id = %d AND position < %d AND status != 'completed'", $now, $now, $project_id, $phase['position'] ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// Only one phase in progress.
		$wpdb->query( $wpdb->prepare( "UPDATE {$t} SET status = 'queued', started_at = NULL WHERE project_id = %d AND position > %d AND status = 'ongoing'", $project_id, $phase['position'] ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}
	$fields = array( 'status' => $status );
	if ( 'ongoing' === $status ) {
		$fields['started_at']   = $phase['started_at'] ? $phase['started_at'] : $now;
		$fields['completed_at'] = null;
	} elseif ( 'completed' === $status ) {
		$fields['started_at']   = $phase['started_at'] ? $phase['started_at'] : $now;
		$fields['completed_at'] = $now;
	} else {
		$fields['started_at']   = null;
		$fields['completed_at'] = null;
	}
	if ( '' !== $note ) {
		$fields['note'] = $note;
	}
	$wpdb->update( $t, $fields, array( 'id' => $phase_id ) );

	// When a phase completes, raise any milestone invoices now due, then start the next phase
	// automatically unless it is held behind an unpaid milestone.
	if ( 'completed' === $status ) {
		pd_bill_completed_milestones( $project_id );
		$ongoing = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$t} WHERE project_id = %d AND status = 'ongoing'", $project_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( ! $ongoing ) {
			$next = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE project_id = %d AND position > %d AND status = 'queued' ORDER BY position ASC LIMIT 1", $project_id, $phase['position'] ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			if ( $next && ! pd_milestone_blocks_phase( $project_id, (int) $next['position'] ) ) {
				$wpdb->update( $t, array( 'status' => 'ongoing', 'started_at' => $now ), array( 'id' => $next['id'] ) );
			}
		}
	}

	$project = pd_get_row( 'projects', $project_id );
	$left    = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$t} WHERE project_id = %d AND status != 'completed'", $project_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$closed  = 0 === $left && ! $project['recurring'];
	if ( in_array( $project['status'], array( 'active', 'completed' ), true ) ) {
		$wpdb->update( pd_table( 'projects' ), array( 'status' => $closed ? 'completed' : 'active' ), array( 'id' => $project_id ) );
	}

	$client  = pd_get_row( 'clients', (int) $project['client_id'] );
	$current = $wpdb->get_var( $wpdb->prepare( "SELECT name FROM {$t} WHERE project_id = %d AND status = 'ongoing' LIMIT 1", $project_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$head    = 'completed' === $status ? "{$phase['name']} is complete" : ( 'ongoing' === $status ? "{$phase['name']} is now in progress" : "{$phase['name']} is back in the queue" );
	$detail  = $closed ? "Every phase on {$project['name']} is complete. Thank you! We'd love a short review in the portal." : ( $current ? "Now in progress on {$project['name']}: {$current}." : "The plan for {$project['name']} was updated." );
	pd_notify(
		array(
			array(
				'audience'   => 'client',
				'client_id'  => (int) $project['client_id'],
				'project_id' => $project_id,
				'title'      => 'Project update — ' . $head,
				'body'       => $detail . ( '' !== $note ? "\n\nNote from the team: {$note}" : '' ),
				'channels'   => array( 'email' ),
				'email'      => $client['email'] ?? '',
			),
		)
	);
	return array( 'projectStatus' => $closed ? 'completed' : $project['status'] );
}

/** Client approval of a sign-off phase. */
function pd_approve_phase( int $phase_id, int $client_id, int $user_id, string $note ) {
	global $wpdb;
	$phase   = pd_get_row( 'phases', $phase_id );
	$project = $phase ? pd_get_row( 'projects', (int) $phase['project_id'] ) : null;
	if ( ! $phase || ! $project || (int) $project['client_id'] !== $client_id ) {
		return pd_error( 'Phase not found.', 404 );
	}
	if ( ! $phase['signoff'] ) {
		return pd_error( 'This phase does not need your approval.' );
	}
	if ( $phase['approved_at'] ) {
		return pd_error( 'You already approved this phase.', 409 );
	}
	if ( 'ongoing' !== $phase['status'] ) {
		return pd_error( 'You can approve this phase once it is in progress.', 409 );
	}
	$wpdb->update(
		pd_table( 'phases' ),
		array( 'approved_at' => pd_now(), 'approved_by' => $user_id, 'approval_note' => $note ),
		array( 'id' => $phase_id )
	);
	pd_notify(
		array(
			array(
				'audience'   => 'staff',
				'client_id'  => $client_id,
				'project_id' => (int) $project['id'],
				'title'      => "Approved: {$phase['name']} — {$project['name']}",
				'body'       => 'The client approved this phase.' . ( $note ? "\n\nTheir note: {$note}" : '' ),
				'channels'   => array( 'email', 'whatsapp' ),
			),
		)
	);
	return true;
}

/* --------------------------------------------------------------- documents */

/** Client signature, with the evidence kept for the record. */
function pd_sign_document( int $document_id, int $client_id, int $user_id, string $name, string $image, bool $agreed ) {
	global $wpdb;
	$doc = pd_get_row( 'documents', $document_id );
	if ( ! $doc || (int) $doc['client_id'] !== $client_id ) {
		return pd_error( 'Document not found.', 404 );
	}
	if ( 'signed' === $doc['status'] ) {
		return pd_error( 'This document is already signed.', 409 );
	}
	if ( ! $agreed ) {
		return pd_error( 'Tick the box to confirm you have read and agree to the document.' );
	}
	if ( mb_strlen( $name ) < 2 ) {
		return pd_error( 'Type your full legal name.' );
	}
	if ( 0 !== strpos( $image, 'data:image/png;base64,' ) || strlen( $image ) > 400000
		|| false === base64_decode( substr( $image, 22 ), true ) ) {
		return pd_error( 'Draw your signature in the signature pad.' );
	}
	if ( ! hash_equals( (string) $doc['body_hash'], hash( 'sha256', (string) $doc['body'] ) ) ) {
		return pd_error( 'This document changed since it was sent. Refresh and read it again.', 409 );
	}
	$agent = isset( $_SERVER['HTTP_USER_AGENT'] ) ? mb_substr( sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ), 0, 400 ) : '';
	$now   = pd_now();
	$wpdb->update(
		pd_table( 'documents' ),
		array(
			'status'          => 'signed',
			'signature_name'  => $name,
			'signature_image' => $image,
			'signer_user_id'  => $user_id,
			'signer_ip'       => pd_client_ip(),
			'signer_agent'    => $agent,
			'signed_at'       => $now,
		),
		array( 'id' => $document_id, 'status' => 'awaiting_signature' )
	);
	$client = pd_get_row( 'clients', $client_id );
	pd_notify(
		array(
			array(
				'audience'   => 'staff',
				'client_id'  => $client_id,
				'project_id' => $doc['project_id'] ? (int) $doc['project_id'] : null,
				'title'      => 'Signed: ' . $doc['title'],
				'body'       => "{$name} signed \"{$doc['title']}\" for {$client['company']}.",
				'channels'   => array( 'email', 'whatsapp' ),
			),
			array(
				'audience'   => 'client',
				'client_id'  => $client_id,
				'project_id' => $doc['project_id'] ? (int) $doc['project_id'] : null,
				'title'      => 'Your signed copy: ' . $doc['title'],
				'body'       => "Thank you, {$name}. Your signed copy is saved in the Documents tab of your portal.",
				'channels'   => array( 'email' ),
				'email'      => $client['email'],
			),
		)
	);
	if ( $doc['project_id'] ) {
		if ( 'agreement' === $doc['kind'] ) {
			pd_create_deposit_invoice( (int) $doc['project_id'] );
		}
		pd_maybe_unlock_work( (int) $doc['project_id'] );
	}
	return pd_iso( $now );
}
