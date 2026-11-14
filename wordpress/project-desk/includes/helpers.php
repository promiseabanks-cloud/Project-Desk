<?php
/**
 * Small shared helpers: table names, time, input cleaning and who is asking.
 *
 * @package Project_Desk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Full table name for one of the plugin's tables, e.g. pd_table( 'clients' ). */
function pd_table( string $name ): string {
	global $wpdb;
	return $wpdb->prefix . 'pd_' . $name;
}

/** Current time as a UTC MySQL datetime. */
function pd_now(): string {
	return gmdate( 'Y-m-d H:i:s' );
}

/** Trimmed plain text capped at $max characters; anything that is not a string becomes ''. */
function pd_text( $value, int $max ): string {
	if ( ! is_string( $value ) && ! is_numeric( $value ) ) {
		return '';
	}
	return mb_substr( trim( sanitize_text_field( (string) $value ) ), 0, $max );
}

/** Multi-line plain text (keeps line breaks) capped at $max characters. */
function pd_textarea( $value, int $max ): string {
	if ( ! is_string( $value ) ) {
		return '';
	}
	return mb_substr( trim( sanitize_textarea_field( $value ) ), 0, $max );
}

/** Returns $value when it is one of $allowed, otherwise $fallback. */
function pd_one_of( $value, array $allowed, $fallback ) {
	return in_array( $value, $allowed, true ) ? $value : $fallback;
}

/** A YYYY-MM-DD date or null. */
function pd_date( $value ): ?string {
	$raw = is_string( $value ) ? trim( $value ) : '';
	if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $raw ) ) {
		return null;
	}
	[ $y, $m, $d ] = array_map( 'intval', explode( '-', $raw ) );
	return checkdate( $m, $d, $y ) ? $raw : null;
}

/** Money in the main unit (e.g. naira) to minor units (kobo). Null when invalid. */
function pd_money( $value ): ?int {
	if ( is_string( $value ) ) {
		$value = preg_replace( '/[^0-9.]/', '', $value );
	}
	if ( ! is_numeric( $value ) ) {
		return null;
	}
	$amount = (float) $value;
	if ( $amount <= 0 || $amount > 10000000000 ) {
		return null;
	}
	return (int) round( $amount * 100 );
}

/** A WP_Error the REST API turns into a JSON error with the given status. */
function pd_error( string $message, int $status = 400, string $code = 'pd_error' ): WP_Error {
	return new WP_Error( $code, $message, array( 'status' => $status ) );
}

/** True when the current user works for the business (owner or project manager). */
function pd_is_staff( ?int $user_id = null ): bool {
	return $user_id ? user_can( $user_id, 'pd_manage_projects' ) : current_user_can( 'pd_manage_projects' );
}

/** The client record id linked to a user, or 0. */
function pd_client_id_for_user( int $user_id ): int {
	global $wpdb;
	if ( ! $user_id ) {
		return 0;
	}
	return (int) $wpdb->get_var(
		$wpdb->prepare( 'SELECT id FROM ' . pd_table( 'clients' ) . ' WHERE user_id = %d', $user_id ) // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	);
}

/** Client IP for the signing record. Only REMOTE_ADDR is trusted unless a proxy header is allowed by filter. */
function pd_client_ip(): string {
	$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
	/**
	 * Filters the IP address recorded for signatures and rate limits. Sites behind a
	 * trusted proxy or CDN can return the forwarded address here.
	 */
	return (string) apply_filters( 'pd_client_ip', $ip );
}

/** Simple fixed-window rate limit. Returns false once $limit hits happen within $window seconds. */
function pd_rate_limit( string $bucket, int $limit, int $window ): bool {
	$key   = 'pd_rl_' . md5( $bucket );
	$count = (int) get_transient( $key );
	if ( $count >= $limit ) {
		return false;
	}
	set_transient( $key, $count + 1, $window );
	return true;
}
