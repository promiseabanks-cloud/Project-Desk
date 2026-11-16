<?php
/**
 * Public intake: a prospective client submits an enquiry from a public form, it lands as a lead
 * for the team, who can turn it into an onboarded client.
 *
 * @package Project_Desk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** A lead row shaped for the app. */
function pd_map_lead( array $x ): array {
	return array(
		'id'          => (int) $x['id'],
		'company'     => (string) $x['company'],
		'contactName' => (string) $x['contact_name'],
		'email'       => (string) $x['email'],
		'phone'       => (string) $x['phone'],
		'service'     => (string) $x['service'],
		'budget'      => (string) $x['budget'],
		'message'     => (string) $x['message'],
		'source'      => (string) $x['source'],
		'status'      => (string) $x['status'],
		'clientId'    => $x['client_id'] ? (int) $x['client_id'] : null,
		'createdAt'   => pd_iso( $x['created_at'] ),
	);
}

/** All leads, newest first, for the team console. */
function pd_load_leads(): array {
	global $wpdb;
	$rows = $wpdb->get_results( 'SELECT * FROM ' . pd_table( 'leads' ) . ' ORDER BY created_at DESC, id DESC', ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	return array_map( 'pd_map_lead', $rows );
}

/**
 * Records a public enquiry as a lead and alerts the team. Returns the lead id, or a WP_Error.
 * Spam is kept out with a honeypot field and a light per-visitor rate limit.
 */
function pd_submit_lead( array $b ) {
	// Honeypot: real people leave this hidden field empty.
	if ( ! empty( $b['website'] ) ) {
		return array( 'ok' => true ); // Pretend success; drop silently.
	}
	$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '0';
	$key = 'pd_lead_' . md5( $ip );
	$n   = (int) get_transient( $key );
	if ( $n >= 5 ) {
		return pd_error( 'Thanks — we already have your message. We will be in touch shortly.', 429 );
	}

	$name  = pd_text( $b['contactName'] ?? '', 160 );
	$email = sanitize_email( (string) ( $b['email'] ?? '' ) );
	if ( ! $name || ! is_email( $email ) ) {
		return pd_error( 'Please give your name and a valid email so we can reply.' );
	}
	$services = pd_settings()['services'];
	$service  = sanitize_key( (string) ( $b['service'] ?? '' ) );
	if ( $service && ! isset( $services[ $service ] ) ) {
		$service = '';
	}

	global $wpdb;
	$wpdb->insert(
		pd_table( 'leads' ),
		array(
			'company'      => pd_text( $b['company'] ?? '', 160 ),
			'contact_name' => $name,
			'email'        => $email,
			'phone'        => pd_text( $b['phone'] ?? '', 40 ),
			'service'      => $service,
			'budget'       => pd_text( $b['budget'] ?? '', 60 ),
			'message'      => pd_textarea( $b['message'] ?? '', 4000 ),
			'source'       => 'form',
			'status'       => 'new',
			'created_at'   => pd_now(),
		)
	);
	$lead_id = (int) $wpdb->insert_id;
	set_transient( $key, $n + 1, HOUR_IN_SECONDS );

	$label = pd_text( $b['company'] ?? '', 160 ) ?: $name;
	pd_notify(
		array(
			array(
				'audience' => 'staff',
				'title'    => 'New enquiry: ' . $label,
				'body'     => trim( sprintf( '%s (%s) asked about %s. %s', $name, $email, $services[ $service ]['label'] ?? 'your services', pd_textarea( $b['message'] ?? '', 400 ) ) ),
				'channels' => array( 'email' ),
			),
		)
	);
	return array( 'ok' => true, 'leadId' => $lead_id );
}

/** Updates a lead's status (new, contacted, archived) and, when converting, links the client. */
function pd_update_lead( int $lead_id, string $status, int $client_id = 0 ) {
	global $wpdb;
	$lead = pd_get_row( 'leads', $lead_id );
	if ( ! $lead ) {
		return pd_error( 'Lead not found.', 404 );
	}
	$status = pd_one_of( $status, array( 'new', 'contacted', 'converted', 'archived' ), $lead['status'] );
	$fields = array( 'status' => $status );
	if ( $client_id > 0 ) {
		$fields['client_id'] = $client_id;
	}
	$wpdb->update( pd_table( 'leads' ), $fields, array( 'id' => $lead_id ) );
	return pd_map_lead( pd_get_row( 'leads', $lead_id ) );
}
