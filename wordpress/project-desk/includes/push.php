<?php
/**
 * Web Push notifications for the PWA. Staff and clients subscribe from the app; when something
 * happens (pd_notify), a push is sent to the right people's devices so it rings in the phone's
 * notification centre even when the app is closed.
 *
 * Implements VAPID (RFC 8292) and the aes128gcm payload encryption (RFC 8291 + RFC 8188) in pure
 * PHP with OpenSSL, and posts to the push service with raw cURL (WordPress' HTTP API is blocked
 * for outbound calls on this host).
 *
 * @package Project_Desk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/* ------------------------------------------------------------- small helpers */

function pd_b64url( string $bin ): string {
	return rtrim( strtr( base64_encode( $bin ), '+/', '-_' ), '=' );
}

function pd_b64url_decode( string $s ): string {
	$pad = strlen( $s ) % 4;
	return (string) base64_decode( strtr( $s, '-_', '+/' ) . ( $pad ? str_repeat( '=', 4 - $pad ) : '' ) );
}

/** Left-pads a big-endian integer to a fixed byte length. */
function pd_pad_left( string $bin, int $len ): string {
	return str_pad( substr( $bin, -$len ), $len, "\0", STR_PAD_LEFT );
}

/** An EC P-256 public key, as a PEM, built from its raw 65-byte uncompressed point. */
function pd_ec_pem_from_point( string $point ): string {
	// SubjectPublicKeyInfo prefix for id-ecPublicKey / prime256v1 + uncompressed point header.
	$der = hex2bin( '3059301306072a8648ce3d020106082a8648ce3d030107034200' ) . $point;
	return "-----BEGIN PUBLIC KEY-----\n" . chunk_split( base64_encode( $der ), 64, "\n" ) . "-----END PUBLIC KEY-----\n";
}

/** Converts a DER-encoded ECDSA signature (SEQUENCE of two INTEGERs) to the raw 64-byte r||s. */
function pd_der_to_raw( string $der ): string {
	$o = 0;
	if ( "\x30" !== $der[ $o++ ] ) {
		return '';
	}
	$len = ord( $der[ $o++ ] );
	if ( $len & 0x80 ) {
		$o += ( $len & 0x7f );
	}
	$read = static function () use ( $der, &$o ) {
		if ( "\x02" !== $der[ $o++ ] ) {
			return '';
		}
		$l = ord( $der[ $o++ ] );
		$v = substr( $der, $o, $l );
		$o += $l;
		return ltrim( $v, "\0" );
	};
	$r = $read();
	$s = $read();
	return pd_pad_left( $r, 32 ) . pd_pad_left( $s, 32 );
}

/* -------------------------------------------------------------- VAPID keys */

/** The server's VAPID keys, generated once and stored. ['public' => b64url point, 'pem' => private PEM]. */
function pd_vapid_keys(): array {
	$stored = get_option( 'pd_vapid_keys' );
	if ( is_array( $stored ) && ! empty( $stored['public'] ) && ! empty( $stored['pem'] ) ) {
		return $stored;
	}
	$res = openssl_pkey_new( array( 'curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC ) );
	if ( ! $res ) {
		return array( 'public' => '', 'pem' => '' );
	}
	openssl_pkey_export( $res, $pem );
	$d      = openssl_pkey_get_details( $res );
	$point  = "\x04" . pd_pad_left( $d['ec']['x'], 32 ) . pd_pad_left( $d['ec']['y'], 32 );
	$keys   = array( 'public' => pd_b64url( $point ), 'pem' => $pem );
	update_option( 'pd_vapid_keys', $keys, false );
	return $keys;
}

function pd_push_public_key(): string {
	return pd_vapid_keys()['public'];
}

/* ------------------------------------------------------- subscription store */

/** Saves or refreshes a device subscription for a user. */
function pd_push_save( int $user_id, string $endpoint, string $p256dh, string $auth, string $ua ): void {
	global $wpdb;
	if ( ! $user_id || ! $endpoint || ! $p256dh || ! $auth ) {
		return;
	}
	$wpdb->query(
		$wpdb->prepare(
			'INSERT INTO ' . pd_table( 'push_subs' ) . ' (user_id, endpoint, endpoint_hash, p256dh, auth, ua, created_at)
			VALUES (%d, %s, %s, %s, %s, %s, %s)
			ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), endpoint = VALUES(endpoint), p256dh = VALUES(p256dh), auth = VALUES(auth), ua = VALUES(ua)', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$user_id,
			$endpoint,
			hash( 'sha256', $endpoint ),
			$p256dh,
			$auth,
			mb_substr( $ua, 0, 255 ),
			pd_now()
		)
	);
}

function pd_push_delete( string $endpoint ): void {
	global $wpdb;
	$wpdb->delete( pd_table( 'push_subs' ), array( 'endpoint_hash' => hash( 'sha256', $endpoint ) ) );
}

/** Subscriptions for a set of user ids. */
function pd_push_subs_for( array $user_ids ): array {
	global $wpdb;
	$user_ids = array_values( array_unique( array_filter( array_map( 'intval', $user_ids ) ) ) );
	if ( ! $user_ids ) {
		return array();
	}
	$in = implode( ',', array_fill( 0, count( $user_ids ), '%d' ) );
	return (array) $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . pd_table( 'push_subs' ) . " WHERE user_id IN ($in)", $user_ids ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.PreparedSQLPlaceholders
}

/* ---------------------------------------------------------- encrypt + send */

/**
 * Encrypts a payload for one subscription and returns the aes128gcm body plus the VAPID
 * Authorization header, or null if the keys are unusable.
 */
function pd_webpush_build( array $sub, string $payload ): ?array {
	$client_pub = pd_b64url_decode( $sub['p256dh'] );   // 65-byte uncompressed point
	$auth_secret = pd_b64url_decode( $sub['auth'] );     // 16 bytes
	if ( 65 !== strlen( $client_pub ) ) {
		return null;
	}

	// Ephemeral server keypair for this message.
	$server = openssl_pkey_new( array( 'curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC ) );
	if ( ! $server ) {
		return null;
	}
	$sd         = openssl_pkey_get_details( $server );
	$server_pub = "\x04" . pd_pad_left( $sd['ec']['x'], 32 ) . pd_pad_left( $sd['ec']['y'], 32 );

	// ECDH shared secret with the client's public key.
	$client_key = openssl_pkey_get_public( pd_ec_pem_from_point( $client_pub ) );
	if ( ! $client_key ) {
		return null;
	}
	$shared = openssl_pkey_derive( $client_key, $server );
	if ( ! $shared ) {
		return null;
	}

	// RFC 8291: combine the auth secret into the key material.
	$key_info = 'WebPush: info' . "\0" . $client_pub . $server_pub;
	$ikm      = hash_hkdf( 'sha256', $shared, 32, $key_info, $auth_secret );

	// RFC 8188 aes128gcm: derive the content key and nonce from a random salt.
	$salt  = random_bytes( 16 );
	$cek   = hash_hkdf( 'sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt );
	$nonce = hash_hkdf( 'sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt );

	// Single record: payload + the 0x02 last-record delimiter, no extra padding.
	$tag        = '';
	$ciphertext = openssl_encrypt( $payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag, '', 16 );
	if ( false === $ciphertext ) {
		return null;
	}

	// Header: salt(16) | record size(4) | key id length(1) | server public key(65) | ciphertext.
	$body = $salt . pack( 'N', 4096 ) . chr( strlen( $server_pub ) ) . $server_pub . $ciphertext . $tag;

	// VAPID JWT (ES256) for the Authorization header.
	$vapid = pd_vapid_keys();
	$parts = wp_parse_url( $sub['endpoint'] );
	$aud   = $parts['scheme'] . '://' . $parts['host'];
	$s     = pd_settings();
	$email = is_email( (string) $s['business_email'] ) ? $s['business_email'] : 'admin@' . ( wp_parse_url( home_url(), PHP_URL_HOST ) ?: 'example.com' );
	$jwt_in = pd_b64url( '{"typ":"JWT","alg":"ES256"}' ) . '.' . pd_b64url( (string) wp_json_encode( array( 'aud' => $aud, 'exp' => time() + 43200, 'sub' => 'mailto:' . $email ) ) );
	$der    = '';
	if ( ! openssl_sign( $jwt_in, $der, $vapid['pem'], OPENSSL_ALGO_SHA256 ) ) {
		return null;
	}
	$jwt = $jwt_in . '.' . pd_b64url( pd_der_to_raw( $der ) );

	return array(
		'body'    => $body,
		'headers' => array(
			'Content-Type: application/octet-stream',
			'Content-Encoding: aes128gcm',
			'TTL: 86400',
			'Urgency: high',
			'Authorization: vapid t=' . $jwt . ', k=' . $vapid['public'],
		),
	);
}

/** Sends one notification payload to the given user ids' devices. */
function pd_push_to_users( array $user_ids, array $payload ): void {
	$subs = pd_push_subs_for( $user_ids );
	if ( ! $subs || ! function_exists( 'openssl_pkey_derive' ) ) {
		return;
	}
	$json  = (string) wp_json_encode( $payload );
	$multi = curl_multi_init(); // phpcs:ignore WordPress.WP.AlternativeFunctions
	$jobs  = array();
	foreach ( array_slice( $subs, 0, 100 ) as $sub ) {
		$built = pd_webpush_build( $sub, $json );
		if ( ! $built ) {
			continue;
		}
		$ch = curl_init( $sub['endpoint'] ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		curl_setopt_array( // phpcs:ignore WordPress.WP.AlternativeFunctions
			$ch,
			array(
				CURLOPT_POST           => true,
				CURLOPT_POSTFIELDS     => $built['body'],
				CURLOPT_HTTPHEADER     => $built['headers'],
				CURLOPT_RETURNTRANSFER => true,
				CURLOPT_TIMEOUT        => 10,
			)
		);
		curl_multi_add_handle( $multi, $ch ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		$jobs[] = array( 'ch' => $ch, 'endpoint' => $sub['endpoint'] );
	}
	if ( ! $jobs ) {
		curl_multi_close( $multi ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		return;
	}
	do {
		$status = curl_multi_exec( $multi, $running ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		if ( $running ) {
			curl_multi_select( $multi, 1.0 ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		}
	} while ( $running && CURLM_OK === $status );
	foreach ( $jobs as $job ) {
		$code = (int) curl_getinfo( $job['ch'], CURLINFO_HTTP_CODE ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		// 404/410 mean the subscription is dead — drop it so it is not retried.
		if ( 404 === $code || 410 === $code ) {
			pd_push_delete( $job['endpoint'] );
		}
		curl_multi_remove_handle( $multi, $job['ch'] ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		curl_close( $job['ch'] ); // phpcs:ignore WordPress.WP.AlternativeFunctions
	}
	curl_multi_close( $multi ); // phpcs:ignore WordPress.WP.AlternativeFunctions
}

/**
 * Works out who a notification is for and pushes it to their devices. Staff notices go to every
 * staff member's devices; a client notice goes to that client's own devices.
 */
function pd_push_dispatch( array $in, string $audience ): void {
	if ( 'client' === $audience ) {
		$client = $in['client_id'] ? pd_get_row( 'clients', (int) $in['client_id'] ) : null;
		$users  = $client && $client['user_id'] ? array( (int) $client['user_id'] ) : array();
	} else {
		$users = array_map( static fn( $u ) => $u->ID, get_users( array( 'role__in' => array( 'pd_owner', 'pd_manager', 'administrator' ), 'fields' => array( 'ID' ) ) ) );
	}
	if ( ! $users ) {
		return;
	}
	pd_push_to_users(
		$users,
		array(
			'title' => (string) $in['title'],
			'body'  => mb_substr( wp_strip_all_tags( (string) $in['body'] ), 0, 160 ),
			'url'   => (string) ( $in['link'] ?? pd_settings()['portal_url'] ),
		)
	);
}
