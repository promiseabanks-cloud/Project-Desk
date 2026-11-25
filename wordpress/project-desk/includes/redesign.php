<?php
/**
 * Free Redesign Program: the welcome email every client onboarded under that service receives.
 * It lays out the terms (timely resources, reviews and replies), explains the file categories
 * and how to find their way around the portal, how to install it as an app, and that a monetary
 * appreciation is welcome but optional while a review is much appreciated.
 *
 * @package Project_Desk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** A titled block of the welcome email: a heading and a list of "Label — text" items. */
function pd_email_section( string $heading, array $items, bool $numbered = false ): string {
	$h  = '<h2 style="margin:22px 0 10px;font-size:16px;line-height:1.35;font-weight:700;color:#0E1A1B">' . esc_html( $heading ) . '</h2>';
	$h .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px">';
	$n  = 0;
	foreach ( $items as $label => $text ) {
		++$n;
		$mark = $numbered ? (string) $n : '&bull;';
		$h   .= '<tr><td width="28" valign="top" style="padding:0 0 12px"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:11px;background:#E8F0EE;color:#0B3B40;font-size:12px;font-weight:700">' . $mark . '</span></td>';
		$h   .= '<td valign="top" style="padding:0 0 12px;font-size:14.5px;line-height:1.6;color:#22302F"><strong style="color:#0E1A1B">' . esc_html( (string) $label ) . '</strong> &mdash; ' . esc_html( (string) $text ) . '</td></tr>';
	}
	return $h . '</table>';
}

/** The welcome email's body: returns array( intro text, extra HTML ). */
function pd_free_redesign_welcome_parts( string $first_name, string $business ): array {
	$intro  = sprintf( "Hello %s,\n\nCongratulations! You have been selected for a free website redesign slot with %s, and we are genuinely glad to have you on board. Your project is already set up in Project Desk, your private portal where you will follow every step of the redesign from start to finish.\n\nThere is no fee for this redesign, so there is nothing to sign or pay. What makes it work is speed on both sides, so please read the few simple terms below.", $first_name ?: 'there', $business );
	$html   = pd_email_section(
		'The terms: timely, from both of us',
		array(
			'Deliver your resources on time' => 'Upload your text, pictures, videos and any other files as soon as you can, ideally within the first few days. We cannot start building until we have what we need.',
			'Review on time'                 => 'When we ask for your review or approval, please respond promptly. Waiting on feedback is the number one reason projects run late.',
			'Respond on time'                => 'Reply to our messages and questions quickly. A short answer today is better than a perfect answer next week.',
			'Why it matters'                 => 'Delays on your side move your delivery date back, because we plan our free slots tightly. The quicker we hear from you, the quicker your new site goes live.',
		)
	);
	$html  .= pd_email_section(
		'Where your resources go',
		array(
			'Open your project, then the Files tab' => 'Everything you upload is sorted into tidy categories so nothing gets lost.',
			'Text'                                  => 'Your brief, page copy, descriptions and notes (Brief, Copy and Notes).',
			'Domain and hosting logins'             => 'If you already have your own domain name and web hosting, add your login details for both (domain registrar and hosting control panel) as a note in the Notes section, so we can publish your new site. Please share them only through your portal, never by email or chat.',
			'Pictures'                              => 'Logos, brand assets, product and team photos (Brand and Images).',
			'Videos'                                => 'Any footage you want on the site (Video).',
			'Other files'                           => 'References, price lists, documents and data (References and Data).',
		)
	);
	$html  .= pd_email_section(
		'A quick tour of Project Desk',
		array(
			'Home'     => 'Your next steps at a glance, and anything waiting on you.',
			'Projects' => 'Open your redesign to see the progress ring and each step, from your resources through to launch.',
			'Plan'     => 'The step-by-step timeline. When a step needs your approval, you will see an Approve button.',
			'Files'    => 'Upload your resources, and see the files we share back for your review.',
			'Messages' => 'Chat with our team about this project. Everything stays in one place.',
			'Bell'     => 'Notifications for every update, so you always know what has changed.',
		),
		true
	);
	$html  .= pd_email_section(
		'Install it as an app on your phone',
		array(
			'iPhone (Safari)'  => 'Tap the Share button, then Add to Home Screen.',
			'Android (Chrome)' => 'Tap the menu, then Install app or Add to Home screen.',
			'Why'              => 'It opens like a normal app, tracks your project live, and can send you notifications when something needs your attention.',
		)
	);
	$html  .= '<h2 style="margin:22px 0 10px;font-size:16px;line-height:1.35;font-weight:700;color:#0E1A1B">A small thank-you, entirely optional</h2>';
	$html  .= '<p style="margin:0 0 16px;font-size:14.5px;line-height:1.65;color:#22302F">This redesign is our gift, and nothing is expected in return. If you would like to show appreciation with a gift of money, that is welcome and never required. What would mean the most to us is a nice review of your experience once your new site is live.</p>';
	$html  .= '<p style="margin:0 0 18px;font-size:14.5px;line-height:1.65;color:#22302F">We look forward to building something great with you.</p>';
	return array( $intro, $html );
}

/**
 * Sends the Free Redesign Program welcome email to a client and records it in-app. Does nothing
 * for a client with no usable email address beyond the in-app note.
 */
function pd_send_free_redesign_welcome( int $client_id, int $project_id, string $contact_name, string $email ): void {
	$s      = pd_settings();
	$first  = trim( (string) strtok( $contact_name, ' ' ) );
	$title  = sprintf( 'Congratulations, you have a free redesign slot with %s', $s['business_name'] );
	[ $intro, $html ] = pd_free_redesign_welcome_parts( $first, (string) $s['business_name'] );
	pd_notify(
		array(
			array(
				'audience'   => 'client',
				'client_id'  => $client_id,
				'project_id' => $project_id,
				'title'      => $title,
				'body'       => $intro,
				'html'       => $html,
				'button'     => 'Open your portal',
				'channels'   => array( 'email' ),
				'email'      => $email,
			),
		)
	);
}
