<?php
/**
 * Business settings. Everything that is specific to one business (name, brand, currency,
 * services, phases, agreement wording) lives here as an option, never in code, so the same
 * plugin can run for another business by changing settings.
 *
 * @package Project_Desk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Phases every project starts with. The third is completed automatically once the agreement is
 * signed and the deposit is paid; work phases cannot start before that.
 */
function pd_opening_phases(): array {
	return array(
		array( 'name' => 'Brief received', 'stage' => 'opening', 'signoff' => false ),
		array( 'name' => 'Fixed price sent', 'stage' => 'opening', 'signoff' => false ),
		array( 'name' => 'Agreement signed and deposit paid', 'stage' => 'opening', 'signoff' => false ),
	);
}

/** Default services and their work phases (Banks Solution). Signoff phases need the client's approval. */
function pd_default_services(): array {
	$p = static fn( string $name, bool $signoff = false ) => array( 'name' => $name, 'signoff' => $signoff );
	return array(
		'website'    => array(
			'label'     => 'Websites & e-commerce',
			'recurring' => false,
			'phases'    => array(
				$p( 'Discovery and content gathering' ),
				$p( 'Sitemap and wireframes' ),
				$p( 'Visual design (2 revision rounds)', true ),
				$p( 'Build' ),
				$p( 'Content, SEO and payments setup' ),
				$p( 'Testing and your review', true ),
				$p( 'Launch' ),
				$p( 'Handover and training' ),
			),
		),
		'web_app'    => array(
			'label'     => 'Web apps & custom solutions',
			'recurring' => false,
			'phases'    => array(
				$p( 'Written spec', true ),
				$p( 'Discovery and user flows' ),
				$p( 'Wireframes and clickable prototype', true ),
				$p( 'UI design' ),
				$p( 'Build in milestones with demos', true ),
				$p( 'Integrations and data' ),
				$p( 'Testing with real cases', true ),
				$p( 'Launch' ),
				$p( 'Handover and support' ),
			),
		),
		'automation' => array(
			'label'     => 'Automation & CRM',
			'recurring' => true,
			'phases'    => array(
				$p( 'Process mapping', true ),
				$p( 'Tool setup and data import' ),
				$p( 'Automations build' ),
				$p( 'Testing with real cases' ),
				$p( 'Team training' ),
				$p( 'Go-live', true ),
				$p( 'Monthly optimisation' ),
			),
		),
		'ai'         => array(
			'label'     => 'AI solutions',
			'recurring' => true,
			'phases'    => array(
				$p( 'Use case and data review' ),
				$p( 'Prototype' ),
				$p( 'Pilot with your team', true ),
				$p( 'Refine' ),
				$p( 'Launch' ),
				$p( 'Monthly review' ),
			),
		),
		'seo'        => array(
			'label'     => 'SEO & AI search',
			'recurring' => true,
			'phases'    => array(
				$p( 'Audit' ),
				$p( 'Keyword and question research' ),
				$p( 'On-page fixes' ),
				$p( 'Google Business Profile and local listings' ),
				$p( 'Content plan', true ),
				$p( 'Monthly reporting' ),
			),
		),
		'care'       => array(
			'label'     => 'Care plans',
			'recurring' => true,
			'phases'    => array(
				$p( 'Access, backup and baseline check' ),
				$p( 'Monthly care: updates, security, backups, small changes and report' ),
			),
		),
	);
}

/** Default agreement text. Placeholders: {business}, {company}, {service}, {price}, {deposit_percent}, {deposit}, {date}. */
function pd_default_agreement(): string {
	return "1. Engagement\n{business} will deliver the {service} work for {company} described in the fixed price and statement of work shared before this agreement. Progress, files, invoices and messages are kept in the {business} client portal.\n\n2. How the work runs\nThe project moves through the phases shown in your portal. Work starts once this agreement is signed and the deposit is paid. Phases marked for your approval only close when you approve them in the portal.\n\n3. Fees and payment\nThe fixed price for this work is {price}. A deposit of {deposit_percent}% ({deposit}) is invoiced when this agreement is signed, and the balance as set out in the statement of work. Invoices, due dates and receipts appear in the Payments tab. Monthly services are billed at the start of each month.\n\n4. Your responsibilities\nProvide brand assets, content, system access and one decision-maker for approvals. Files you upload are reviewed within two working days.\n\n5. Revisions and approvals\nTwo rounds of revisions are included at each design approval. Feedback is expected within five working days of a request for approval.\n\n6. Ownership and confidentiality\nOn final payment, the deliverables made for {company} belong to {company}. Both parties keep project materials and commercial terms confidential, and personal data is handled in line with the Nigeria Data Protection Act 2023.\n\nAgreed on {date}.";
}

/**
 * A business detail from the active theme when it provides them (the Banks theme does, through
 * banks_detail()), so a first install already carries the right footer details.
 */
function pd_theme_detail( string $key ): string {
	return function_exists( 'banks_detail' ) ? (string) banks_detail( $key ) : '';
}

/** The PNG logo for emails: a setting, else the theme's icon, else the plugin's mark. */
function pd_default_email_logo(): string {
	foreach ( array( get_stylesheet_directory(), get_template_directory() ) as $i => $dir ) {
		if ( file_exists( $dir . '/assets/img/banks-solutions-icon-192.png' ) ) {
			return ( 0 === $i ? get_stylesheet_directory_uri() : get_template_directory_uri() ) . '/assets/img/banks-solutions-icon-192.png';
		}
	}
	return plugins_url( 'assets/email-mark.png', PD_FILE );
}

/** Settings with defaults filled in. */
function pd_settings(): array {
	$defaults = array(
		'business_name'     => get_bloginfo( 'name' ) ? get_bloginfo( 'name' ) : 'Banks Solution',
		'brand_color'       => '#0B3B40',
		'logo_url'          => '',
		'currency'          => 'NGN',
		'portal_url'        => home_url( '/client/' ),
		'staff_alert_email' => get_option( 'admin_email' ),
		'google_client_id'  => '',
		'max_upload_mb'     => 2048,
		'services'          => pd_default_services(),
		'agreement'         => pd_default_agreement(),
		'asset_categories'  => array( 'brief', 'brand', 'copy', 'images', 'video', 'references', 'data', 'notes' ),
		'deposit_percent'   => 50,
		'invoice_due_days'  => 7,
		'bank_details'      => '',
		'legal_name'        => pd_theme_detail( 'legal' ),
		'rc_number'         => pd_theme_detail( 'rc' ),
		'business_email'    => pd_theme_detail( 'email' ) ? pd_theme_detail( 'email' ) : get_option( 'admin_email' ),
		'business_phone'    => pd_theme_detail( 'whatsapp' ),
		'business_address'  => pd_theme_detail( 'locations' ),
		'business_website'  => home_url( '/' ),
		'tagline'           => pd_theme_detail( 'tagline' ),
		'email_logo_url'    => '',
	);
	$saved = get_option( 'pd_settings', array() );
	return array_merge( $defaults, is_array( $saved ) ? $saved : array() );
}

/** Settings that are safe to show to anyone, including signed-out visitors (brand and sign-in options). */
function pd_public_settings(): array {
	$s = pd_settings();
	return array(
		'businessName'   => $s['business_name'],
		'brandColor'     => $s['brand_color'],
		'logoUrl'        => $s['logo_url'],
		'currency'       => $s['currency'],
		'googleClientId' => $s['google_client_id'],
		'maxUploadMb'    => (int) $s['max_upload_mb'],
		'categories'     => array_values( $s['asset_categories'] ),
		'depositPercent' => (int) $s['deposit_percent'],
		'services'       => array_map(
			static fn( $svc ) => array( 'label' => $svc['label'], 'recurring' => (bool) $svc['recurring'] ),
			$s['services']
		),
	);
}

/** Validates and saves a partial settings update. Returns the new settings or an error. */
function pd_update_settings( array $input ) {
	$s = pd_settings();
	if ( isset( $input['businessName'] ) ) {
		$s['business_name'] = pd_text( $input['businessName'], 120 ) ?: $s['business_name'];
	}
	if ( isset( $input['brandColor'] ) ) {
		$color = sanitize_hex_color( (string) $input['brandColor'] );
		if ( ! $color ) {
			return pd_error( 'Brand colour must be a hex colour such as #0f6b4f.' );
		}
		$s['brand_color'] = $color;
	}
	if ( isset( $input['logoUrl'] ) ) {
		$s['logo_url'] = esc_url_raw( (string) $input['logoUrl'] );
	}
	if ( isset( $input['currency'] ) ) {
		$cur = strtoupper( pd_text( $input['currency'], 3 ) );
		if ( ! preg_match( '/^[A-Z]{3}$/', $cur ) ) {
			return pd_error( 'Currency must be a three-letter code such as NGN.' );
		}
		$s['currency'] = $cur;
	}
	if ( isset( $input['portalUrl'] ) ) {
		$s['portal_url'] = esc_url_raw( (string) $input['portalUrl'] );
	}
	if ( isset( $input['staffAlertEmail'] ) ) {
		$email = sanitize_email( (string) $input['staffAlertEmail'] );
		if ( ! is_email( $email ) ) {
			return pd_error( 'Enter a valid alert email address.' );
		}
		$s['staff_alert_email'] = $email;
	}
	if ( isset( $input['googleClientId'] ) ) {
		$s['google_client_id'] = pd_text( $input['googleClientId'], 200 );
	}
	if ( isset( $input['maxUploadMb'] ) ) {
		$s['max_upload_mb'] = max( 1, min( 10240, (int) $input['maxUploadMb'] ) );
	}
	foreach ( array( 'legalName' => 'legal_name', 'rcNumber' => 'rc_number', 'businessPhone' => 'business_phone', 'businessAddress' => 'business_address', 'tagline' => 'tagline' ) as $in_key => $key ) {
		if ( isset( $input[ $in_key ] ) ) {
			$s[ $key ] = pd_text( $input[ $in_key ], 200 );
		}
	}
	if ( isset( $input['businessEmail'] ) ) {
		$email = sanitize_email( (string) $input['businessEmail'] );
		if ( '' !== $email && ! is_email( $email ) ) {
			return pd_error( 'Enter a valid business email address.' );
		}
		$s['business_email'] = $email;
	}
	foreach ( array( 'businessWebsite' => 'business_website', 'emailLogoUrl' => 'email_logo_url' ) as $in_key => $key ) {
		if ( isset( $input[ $in_key ] ) ) {
			$s[ $key ] = esc_url_raw( (string) $input[ $in_key ] );
		}
	}
	if ( isset( $input['depositPercent'] ) ) {
		$s['deposit_percent'] = max( 0, min( 100, (int) $input['depositPercent'] ) );
	}
	if ( isset( $input['invoiceDueDays'] ) ) {
		$s['invoice_due_days'] = max( 0, min( 90, (int) $input['invoiceDueDays'] ) );
	}
	if ( isset( $input['bankDetails'] ) ) {
		$s['bank_details'] = pd_textarea( $input['bankDetails'], 2000 );
	}
	if ( isset( $input['agreement'] ) ) {
		$s['agreement'] = pd_textarea( $input['agreement'], 50000 ) ?: pd_default_agreement();
	}
	if ( isset( $input['services'] ) && is_array( $input['services'] ) ) {
		$services = array();
		foreach ( $input['services'] as $key => $svc ) {
			$key = sanitize_key( (string) $key );
			if ( ! $key || ! is_array( $svc ) || empty( $svc['phases'] ) || ! is_array( $svc['phases'] ) ) {
				return pd_error( 'Each service needs a key, a label and at least one phase.' );
			}
			$phases = array();
			foreach ( $svc['phases'] as $phase ) {
				$name = pd_text( is_array( $phase ) ? ( $phase['name'] ?? '' ) : $phase, 120 );
				if ( $name ) {
					$phases[] = array( 'name' => $name, 'signoff' => ! empty( $phase['signoff'] ) );
				}
			}
			if ( ! $phases ) {
				return pd_error( 'Each service needs at least one named phase.' );
			}
			$services[ $key ] = array(
				'label'     => pd_text( $svc['label'] ?? $key, 80 ) ?: $key,
				'recurring' => ! empty( $svc['recurring'] ),
				'phases'    => $phases,
			);
		}
		$s['services'] = $services;
	}
	update_option( 'pd_settings', $s, false );
	return $s;
}

/**
 * Fills the agreement placeholders. When a price is set and the saved template has no {price}
 * placeholder (an older or custom template), a short fees paragraph is added before the date line.
 */
function pd_agreement_text( string $company, string $service_label, int $price = 0, int $deposit_percent = 0 ): string {
	$s        = pd_settings();
	$template = (string) $s['agreement'];
	$deposit  = (int) round( $price * $deposit_percent / 100 );
	if ( $price > 0 && false === strpos( $template, '{price}' ) ) {
		$fees     = "Price\nThe fixed price for this work is {price}. A deposit of {deposit_percent}% ({deposit}) is invoiced when this agreement is signed.";
		$template = preg_match( '/\n\s*Agreed on \{date\}/', $template )
			? preg_replace( '/(\n\s*Agreed on \{date\})/', "\n\n" . $fees . '$1', $template, 1 )
			: $template . "\n\n" . $fees;
	}
	return strtr(
		$template,
		array(
			'{business}'        => $s['business_name'],
			'{company}'         => $company,
			'{service}'         => $service_label,
			'{price}'           => $price > 0 ? pd_format_money( $price ) : 'as agreed in writing',
			'{deposit_percent}' => (string) $deposit_percent,
			'{deposit}'         => $price > 0 ? pd_format_money( $deposit ) : 'as invoiced',
			'{date}'            => wp_date( 'j F Y' ),
		)
	);
}

/** Money in minor units (kobo) as text, for example ₦250,000 or ₦250,000.50. */
function pd_format_money( int $minor, string $currency = '' ): string {
	$currency = $currency ? $currency : (string) pd_settings()['currency'];
	$symbols  = array( 'NGN' => '₦', 'USD' => '$', 'GBP' => '£', 'EUR' => '€', 'GHS' => '₵', 'KES' => 'KSh ', 'ZAR' => 'R' );
	$symbol   = $symbols[ $currency ] ?? $currency . ' ';
	return $symbol . number_format( $minor / 100, 0 === $minor % 100 ? 0 : 2 );
}
