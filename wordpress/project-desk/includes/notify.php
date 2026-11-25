<?php
/**
 * Notifications: every event is recorded in-app, and email goes out through wp_mail (so the
 * site's SMTP plugin, e.g. FluentSMTP, delivers it). WhatsApp is recorded as queued until a
 * provider is connected.
 *
 * @package Project_Desk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Branded HTML email: the business's logo and name on a deep header, the message, one button,
 * and a footer with the legal name, RC number, address, email, phone, website and tagline.
 * Table layout with inline styles so it holds up in Gmail, Outlook and phone mail apps.
 */
function pd_email_html( string $title, string $body, string $button_url = '', string $button_label = 'Open your portal', string $extra_html = '' ): string {
	$s      = pd_settings();
	$brand  = sanitize_hex_color( (string) $s['brand_color'] ) ? (string) $s['brand_color'] : '#0B3B40';
	$name   = esc_html( (string) $s['business_name'] );
	$logo   = (string) ( $s['email_logo_url'] ? $s['email_logo_url'] : pd_default_email_logo() );
	$font   = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
	$accent = '#F5B72E';

	$legal = array_filter( array( (string) $s['legal_name'], $s['rc_number'] ? 'RC ' . $s['rc_number'] : '', (string) $s['business_address'] ) );
	$reach = array();
	if ( $s['business_email'] ) {
		$reach[] = '<a href="mailto:' . esc_attr( $s['business_email'] ) . '" style="color:#3D5557;text-decoration:none">' . esc_html( $s['business_email'] ) . '</a>';
	}
	if ( $s['business_phone'] ) {
		$reach[] = esc_html( $s['business_phone'] );
	}
	if ( $s['business_website'] ) {
		$host    = wp_parse_url( (string) $s['business_website'], PHP_URL_HOST );
		$reach[] = '<a href="' . esc_url( $s['business_website'] ) . '" style="color:#3D5557;text-decoration:none">' . esc_html( $host ? preg_replace( '/^www\./', '', $host ) : $s['business_website'] ) . '</a>';
	}

	$paragraphs = array_filter( array_map( 'trim', preg_split( "/\n{2,}/", $body ) ) );
	$body_html  = '';
	foreach ( $paragraphs as $para ) {
		$body_html .= '<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#22302F">' . nl2br( esc_html( $para ) ) . '</p>';
	}

	$h  = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>' . esc_html( $title ) . '</title></head>';
	$h .= '<body style="margin:0;padding:0;background:#F4F5F1;font-family:' . $font . '">';
	$h .= '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' . esc_html( mb_substr( wp_strip_all_tags( $body ), 0, 140 ) ) . '</div>';
	$h .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F1"><tr><td align="center" style="padding:28px 12px">';
	$h .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#FFFFFF;border-radius:18px;overflow:hidden;border:1px solid #E3E6DF">';
	// Header.
	$h .= '<tr><td style="background:' . esc_attr( $brand ) . ';padding:22px 28px">';
	$h .= '<table role="presentation" cellpadding="0" cellspacing="0"><tr>';
	if ( $logo ) {
		$h .= '<td style="padding-right:12px;vertical-align:middle"><img src="' . esc_url( $logo ) . '" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px"></td>';
	}
	$h .= '<td style="vertical-align:middle;font-size:17px;font-weight:700;letter-spacing:-0.2px;color:#FFFFFF">' . $name . '</td>';
	$h .= '</tr></table>';
	$h .= '<div style="margin-top:18px;height:3px;width:44px;background:' . $accent . ';border-radius:2px"></div>';
	$h .= '</td></tr>';
	// Message.
	$h .= '<tr><td style="padding:30px 28px 10px">';
	$h .= '<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;font-weight:700;letter-spacing:-0.3px;color:#0E1A1B">' . esc_html( $title ) . '</h1>';
	$h .= $body_html;
	$h .= $extra_html; // Trusted markup built by the plugin (never user input).
	if ( $button_url ) {
		$h .= '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px"><tr><td style="background:' . $accent . ';border-radius:12px">';
		$h .= '<a href="' . esc_url( $button_url ) . '" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:#0E1A1B;text-decoration:none">' . esc_html( $button_label ) . ' &rarr;</a>';
		$h .= '</td></tr></table>';
	}
	$h .= '</td></tr>';
	// Footer.
	$h .= '<tr><td style="padding:20px 28px 26px;border-top:1px solid #ECEEE8;background:#FAFBF8">';
	$h .= '<p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#0E1A1B">' . $name . '</p>';
	if ( $legal ) {
		$h .= '<p style="margin:0 0 4px;font-size:12px;line-height:1.6;color:#5C6E6F">' . esc_html( implode( ' · ', $legal ) ) . '</p>';
	}
	if ( $reach ) {
		$h .= '<p style="margin:0 0 4px;font-size:12px;line-height:1.6;color:#3D5557">' . implode( ' &nbsp;·&nbsp; ', $reach ) . '</p>';
	}
	if ( $s['tagline'] ) {
		$h .= '<p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:#8A9A9A">' . esc_html( $s['tagline'] ) . '</p>';
	}
	$h .= '</td></tr></table>';
	$h .= '<p style="margin:16px 0 0;font-size:11px;color:#8A9A9A">You are receiving this because you have an account in the ' . $name . ' client portal.</p>';
	$h .= '</td></tr></table></body></html>';
	return $h;
}

/** Sends one HTML email. Returns 'sent' or 'failed' ('queued' when there is no recipient). */
function pd_send_email( string $to, string $subject, string $html ): string {
	if ( ! $to || ! is_email( $to ) ) {
		return 'queued';
	}
	$headers = array( 'Content-Type: text/html; charset=UTF-8' );
	return wp_mail( $to, $subject, $html, $headers ) ? 'sent' : 'failed';
}

/**
 * Records and delivers notifications.
 *
 * Each input: audience ('client'|'staff'), client_id, project_id, title, body,
 * channels (subset of ['email','whatsapp']), email (client recipient), link (button URL).
 */
function pd_notify( array $inputs ): void {
	global $wpdb;
	$s = pd_settings();
	foreach ( $inputs as $in ) {
		$audience  = 'client' === ( $in['audience'] ?? '' ) ? 'client' : 'staff';
		$recipient = 'client' === $audience ? (string) ( $in['email'] ?? '' ) : (string) $s['staff_alert_email'];
		$rows      = array( array( 'in_app', 'sent', $recipient ) );
		foreach ( (array) ( $in['channels'] ?? array() ) as $channel ) {
			if ( 'email' === $channel ) {
				$link   = (string) ( $in['link'] ?? $s['portal_url'] );
				$status = pd_send_email( $recipient, (string) $in['title'], pd_email_html( (string) $in['title'], (string) $in['body'], $link, (string) ( $in['button'] ?? ( 'client' === $audience ? 'Open your portal' : 'Open Project Desk' ) ), (string) ( $in['html'] ?? '' ) ) );
				$rows[] = array( 'email', $status, $recipient );
			} elseif ( 'whatsapp' === $channel ) {
				/**
				 * Lets a WhatsApp provider deliver the message. Return 'sent' or 'failed';
				 * the default 'queued' means no provider is connected yet.
				 */
				$status = (string) apply_filters( 'pd_send_whatsapp', 'queued', $in, $audience );
				$rows[] = array( 'whatsapp', $status, '' );
			}
		}
		foreach ( $rows as [ $channel, $status, $to ] ) {
			$wpdb->insert(
				pd_table( 'notifications' ),
				array(
					'audience'   => $audience,
					'client_id'  => $in['client_id'] ?? null,
					'project_id' => $in['project_id'] ?? null,
					'channel'    => $channel,
					'title'      => mb_substr( (string) $in['title'], 0, 255 ),
					'body'       => (string) $in['body'],
					'status'     => $status,
					'recipient'  => $to,
					'created_at' => pd_now(),
				)
			);
		}
		// Ring the recipient's phone(s) with a Web Push, when they have turned it on.
		if ( function_exists( 'pd_push_dispatch' ) ) {
			pd_push_dispatch( $in, $audience );
		}
	}
}
