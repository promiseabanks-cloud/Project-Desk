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

/** Branded HTML email body with a button back to the portal. */
function pd_email_html( string $title, string $body, string $button_url = '', string $button_label = 'Open your portal' ): string {
	$s     = pd_settings();
	$color = esc_attr( $s['brand_color'] );
	$name  = esc_html( $s['business_name'] );
	$html  = '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.6;color:#14181c;max-width:560px">';
	$html .= '<p style="margin:0 0 16px;font-weight:600;color:' . $color . '">' . $name . '</p>';
	$html .= '<h2 style="margin:0 0 12px;font-size:19px">' . esc_html( $title ) . '</h2>';
	$html .= '<p style="margin:0 0 20px">' . nl2br( esc_html( $body ) ) . '</p>';
	if ( $button_url ) {
		$html .= '<p style="margin:0 0 24px"><a href="' . esc_url( $button_url ) . '" style="display:inline-block;background:' . $color . ';color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">' . esc_html( $button_label ) . '</a></p>';
	}
	$html .= '<p style="margin:0;color:#6b7280;font-size:13px">' . $name . ' client portal</p></div>';
	return $html;
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
				$status = pd_send_email( $recipient, (string) $in['title'], pd_email_html( (string) $in['title'], (string) $in['body'], $link ) );
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
	}
}
