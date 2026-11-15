<?php
/**
 * Sign-in for clients and staff, using normal WordPress accounts.
 *
 * Nobody can sign up on their own: an owner or project manager invites them, which creates the
 * account and emails a link to set a password. After that people can sign in with email and
 * password, a one-time email link, or Google (only for an email that was invited).
 *
 * @package Project_Desk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** True when the user may use the portal or console at all. */
function pd_user_has_access( WP_User $user ): bool {
	return user_can( $user, 'pd_client_portal' ) || user_can( $user, 'pd_manage_projects' );
}

/** Builds a link into the app. Tokens go in the URL fragment so they never reach server logs. */
function pd_app_link( string $route, array $params = array() ): string {
	$base = (string) pd_settings()['portal_url'];
	return $base . '#/' . ltrim( $route, '/' ) . ( $params ? '?' . http_build_query( $params ) : '' );
}

/**
 * Creates (or reuses) the account for $email with $role and emails an invite link.
 * Returns the user id or an error.
 */
function pd_invite_user( string $email, string $name, string $role ) {
	$email = sanitize_email( $email );
	if ( ! is_email( $email ) ) {
		return pd_error( 'Enter a valid email address.' );
	}
	$role = pd_one_of( $role, array( 'pd_client', 'pd_manager', 'pd_owner' ), 'pd_client' );
	$user = get_user_by( 'email', $email );
	if ( ! $user ) {
		$login = sanitize_user( strtolower( strstr( $email, '@', true ) ), true );
		$base  = $login ? $login : 'user';
		$i     = 1;
		while ( username_exists( $login ) || ! $login ) {
			$login = $base . ( ++$i );
		}
		$user_id = wp_insert_user(
			array(
				'user_login'   => $login,
				'user_email'   => $email,
				'user_pass'    => wp_generate_password( 32, true, true ),
				'display_name' => $name ? $name : $email,
				'first_name'   => $name,
				'role'         => $role,
			)
		);
		if ( is_wp_error( $user_id ) ) {
			return pd_error( $user_id->get_error_message() );
		}
		$user = get_user_by( 'id', $user_id );
	} else {
		if ( 'pd_client' === $role && user_can( $user, 'pd_manage_projects' ) ) {
			return pd_error( 'That email belongs to a staff account. Use a different email for the client.', 409 );
		}
		if ( ! in_array( $role, (array) $user->roles, true ) && ! user_can( $user, 'administrator' ) ) {
			$user->add_role( $role );
		}
	}
	pd_send_invite( $user );
	return (int) $user->ID;
}

/** Emails a set-password invite to an existing account. */
function pd_send_invite( WP_User $user ): bool {
	$key = get_password_reset_key( $user );
	if ( is_wp_error( $key ) ) {
		return false;
	}
	$s     = pd_settings();
	$link  = pd_app_link( 'invite', array( 'u' => $user->ID, 'k' => $key ) );
	$title = sprintf( 'You are invited to the %s client portal', $s['business_name'] );
	$body  = "Hello {$user->display_name},\n\nSet a password to open your portal. There you can follow your project, upload files, sign documents and message the team. This link works once and expires in 24 hours.";
	return 'sent' === pd_send_email( $user->user_email, $title, pd_email_html( $title, $body, $link, 'Set your password' ) );
}

/**
 * Signs the user in (sets the WordPress auth cookie). The new logged-in cookie is also put into
 * $_COOKIE for the rest of this request, so a REST nonce created now belongs to the new session.
 */
function pd_sign_in( WP_User $user ): void {
	$capture = static function ( $cookie ) {
		$_COOKIE[ LOGGED_IN_COOKIE ] = $cookie;
	};
	add_action( 'set_logged_in_cookie', $capture );
	wp_clear_auth_cookie();
	wp_set_current_user( $user->ID );
	wp_set_auth_cookie( $user->ID, true, is_ssl() );
	remove_action( 'set_logged_in_cookie', $capture );
	do_action( 'wp_login', $user->user_login, $user );
}

/**
 * What the app needs to start: brand, who is signed in and the REST nonce. The app page prints
 * this inline; WordPress only trusts cookie requests that carry the nonce, so it cannot come
 * from an API call made without one.
 */
function pd_boot_payload(): array {
	$user = wp_get_current_user();
	$out  = array(
		'api'   => esc_url_raw( rest_url( 'project-desk/v1' ) ),
		'brand' => pd_public_settings(),
		'nonce' => $user->ID ? wp_create_nonce( 'wp_rest' ) : '',
		'user'  => null,
		'role'  => null,
	);
	if ( $user->ID && pd_user_has_access( $user ) ) {
		$out['user'] = array( 'id' => $user->ID, 'name' => $user->display_name, 'email' => $user->user_email );
		$out['role'] = user_can( $user, 'pd_manage_projects' ) ? ( user_can( $user, 'pd_manage_settings' ) ? 'owner' : 'manager' ) : 'client';
		$out['can']  = array(
			'money'    => user_can( $user, 'pd_manage_money' ),
			'settings' => user_can( $user, 'pd_manage_settings' ),
			'staff'    => user_can( $user, 'pd_manage_staff' ),
			'override' => user_can( $user, 'pd_override_gates' ),
		);
	}
	return $out;
}

/** Accepts an invite: checks the key, sets the password and signs in. */
function pd_accept_invite( int $user_id, string $key, string $password ) {
	$user = get_user_by( 'id', $user_id );
	if ( ! $user ) {
		return pd_error( 'This invite link is not valid. Ask for a new one.', 400 );
	}
	$checked = check_password_reset_key( $key, $user->user_login );
	if ( is_wp_error( $checked ) ) {
		return pd_error( 'This invite link has expired or was already used. Ask for a new one.', 400 );
	}
	if ( strlen( $password ) < 10 ) {
		return pd_error( 'Use at least 10 characters for your password.' );
	}
	reset_password( $checked, $password );
	pd_sign_in( $checked );
	return $checked;
}

/** Email and password sign-in. */
function pd_password_login( string $email, string $password ) {
	$email = sanitize_email( $email );
	if ( ! pd_rate_limit( 'login|' . pd_client_ip() . '|' . strtolower( $email ), 10, 15 * MINUTE_IN_SECONDS ) ) {
		return pd_error( 'Too many attempts. Wait 15 minutes or use an email sign-in link.', 429 );
	}
	$user = get_user_by( 'email', $email );
	if ( ! $user || ! wp_check_password( $password, $user->user_pass, $user->ID ) || ! pd_user_has_access( $user ) ) {
		return pd_error( 'That email and password do not match.', 401 );
	}
	pd_sign_in( $user );
	return $user;
}

/** Emails a one-time sign-in link. Always reports success so emails cannot be probed. */
function pd_request_magic_link( string $email ): void {
	$email = sanitize_email( $email );
	if ( ! is_email( $email ) || ! pd_rate_limit( 'magic|' . strtolower( $email ), 5, 15 * MINUTE_IN_SECONDS ) ) {
		return;
	}
	$user = get_user_by( 'email', $email );
	if ( ! $user || ! pd_user_has_access( $user ) ) {
		return;
	}
	$token = bin2hex( random_bytes( 32 ) );
	update_user_meta(
		$user->ID,
		'pd_magic',
		array(
			'hash'    => hash_hmac( 'sha256', $token, wp_salt( 'auth' ) ),
			'expires' => time() + 15 * MINUTE_IN_SECONDS,
		)
	);
	$s     = pd_settings();
	$title = sprintf( 'Your %s sign-in link', $s['business_name'] );
	$body  = 'Tap the button to sign in. The link works once and expires in 15 minutes. If you did not ask for it, ignore this email.';
	pd_send_email( $user->user_email, $title, pd_email_html( $title, $body, pd_app_link( 'magic', array( 'u' => $user->ID, 't' => $token ) ), 'Sign in' ) );
}

/** Uses a one-time sign-in link. */
function pd_consume_magic_link( int $user_id, string $token ) {
	$user = get_user_by( 'id', $user_id );
	$data = $user ? get_user_meta( $user->ID, 'pd_magic', true ) : null;
	if ( ! $user || ! is_array( $data ) || $data['expires'] < time()
		|| ! hash_equals( (string) $data['hash'], hash_hmac( 'sha256', $token, wp_salt( 'auth' ) ) ) ) {
		return pd_error( 'This sign-in link has expired or was already used. Ask for a new one.', 401 );
	}
	delete_user_meta( $user->ID, 'pd_magic' );
	if ( ! pd_user_has_access( $user ) ) {
		return pd_error( 'This account does not have portal access.', 403 );
	}
	pd_sign_in( $user );
	return $user;
}

/**
 * Verifies a Google ID token and returns its claims, or an error. Uses Google's tokeninfo
 * endpoint, which checks the signature and expiry; we check audience, issuer and email.
 */
function pd_verify_google_token( string $credential ) {
	$client_id = (string) pd_settings()['google_client_id'];
	if ( ! $client_id ) {
		return pd_error( 'Google sign-in is not set up yet.', 400 );
	}
	$claims = apply_filters( 'pd_google_claims', null, $credential );
	if ( null === $claims ) {
		$response = wp_remote_get( 'https://oauth2.googleapis.com/tokeninfo?id_token=' . rawurlencode( $credential ), array( 'timeout' => 10 ) );
		if ( is_wp_error( $response ) || 200 !== wp_remote_retrieve_response_code( $response ) ) {
			return pd_error( 'Google could not confirm this sign-in. Try again.', 401 );
		}
		$claims = json_decode( wp_remote_retrieve_body( $response ), true );
	}
	if ( ! is_array( $claims )
		|| ( $claims['aud'] ?? '' ) !== $client_id
		|| ! in_array( $claims['iss'] ?? '', array( 'accounts.google.com', 'https://accounts.google.com' ), true )
		|| (int) ( $claims['exp'] ?? 0 ) < time()
		|| ! in_array( $claims['email_verified'] ?? false, array( true, 'true' ), true ) ) {
		return pd_error( 'Google could not confirm this sign-in. Try again.', 401 );
	}
	return $claims;
}

/** Google sign-in for an invited email address. */
function pd_google_login( string $credential ) {
	$claims = pd_verify_google_token( $credential );
	if ( is_wp_error( $claims ) ) {
		return $claims;
	}
	$user = get_user_by( 'email', sanitize_email( (string) $claims['email'] ) );
	if ( ! $user || ! pd_user_has_access( $user ) ) {
		return pd_error( 'This Google account has not been invited. Ask your project manager to invite this email.', 403 );
	}
	pd_sign_in( $user );
	return $user;
}

/**
 * Sign-in routes are for signed-out people, so a leftover nonce from an ended session must not
 * block them. WordPress answers such a request with "Cookie check failed"; for these routes we
 * treat the request as signed out instead and let the sign-in go ahead.
 *
 * @param WP_Error|null|true $result Result so far.
 * @return WP_Error|null|true
 */
function pd_allow_stale_nonce_on_sign_in( $result, ?string $route = null ) {
	if ( ! is_wp_error( $result ) || 'rest_cookie_invalid_nonce' !== $result->get_error_code() ) {
		return $result;
	}
	if ( null === $route ) {
		$route = isset( $GLOBALS['wp']->query_vars['rest_route'] ) ? (string) $GLOBALS['wp']->query_vars['rest_route'] : '';
	}
	$public = array( 'login', 'magic-link', 'magic', 'google', 'accept-invite' );
	if ( ! preg_match( '#^/' . preg_quote( PD_NS, '#' ) . '/auth/([a-z-]+)/?$#', $route, $m ) || ! in_array( $m[1], $public, true ) ) {
		return $result;
	}
	wp_set_current_user( 0 );
	return null;
}
