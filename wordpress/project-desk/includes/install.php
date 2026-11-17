<?php
/**
 * Tables, roles and upgrades. Schema changes bump PD_DB_VERSION; dbDelta adds new columns and
 * tables, and anything destructive gets its own step in pd_maybe_upgrade().
 *
 * @package Project_Desk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function pd_schema(): array {
	global $wpdb;
	$c = $wpdb->get_charset_collate();
	return array(
		'CREATE TABLE ' . pd_table( 'clients' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			user_id bigint(20) unsigned NULL,
			company varchar(160) NOT NULL,
			contact_name varchar(160) NOT NULL,
			email varchar(200) NOT NULL,
			phone varchar(40) NOT NULL DEFAULT '',
			website varchar(200) NOT NULL DEFAULT '',
			industry varchar(80) NOT NULL DEFAULT '',
			status varchar(20) NOT NULL DEFAULT 'onboarding',
			notes text NULL,
			brief_id bigint(20) unsigned NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY email (email),
			KEY user_id (user_id)
		) $c;",
		'CREATE TABLE ' . pd_table( 'projects' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			client_id bigint(20) unsigned NOT NULL,
			name varchar(160) NOT NULL,
			service varchar(40) NOT NULL,
			summary text NULL,
			status varchar(20) NOT NULL DEFAULT 'active',
			recurring tinyint(1) NOT NULL DEFAULT 0,
			manager_id bigint(20) unsigned NULL,
			start_date date NULL,
			due_date date NULL,
			price bigint(20) unsigned NOT NULL DEFAULT 0,
			deposit_percent tinyint(3) unsigned NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY client_id (client_id)
		) $c;",
		'CREATE TABLE ' . pd_table( 'phases' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			project_id bigint(20) unsigned NOT NULL,
			name varchar(160) NOT NULL,
			position int(11) NOT NULL DEFAULT 0,
			stage varchar(20) NOT NULL DEFAULT 'work',
			signoff tinyint(1) NOT NULL DEFAULT 0,
			bill_percent tinyint(3) unsigned NOT NULL DEFAULT 0,
			status varchar(20) NOT NULL DEFAULT 'queued',
			note text NULL,
			approved_at datetime NULL,
			approved_by bigint(20) unsigned NULL,
			approval_note text NULL,
			started_at datetime NULL,
			completed_at datetime NULL,
			PRIMARY KEY  (id),
			KEY project_id (project_id)
		) $c;",
		'CREATE TABLE ' . pd_table( 'assets' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			project_id bigint(20) unsigned NOT NULL,
			client_id bigint(20) unsigned NOT NULL,
			category varchar(40) NOT NULL DEFAULT 'brief',
			name varchar(200) NOT NULL,
			kind varchar(20) NOT NULL DEFAULT 'other',
			size bigint(20) unsigned NOT NULL DEFAULT 0,
			mime varchar(120) NOT NULL DEFAULT '',
			storage_key varchar(400) NULL,
			body longtext NULL,
			status varchar(20) NOT NULL DEFAULT 'pending',
			review_note text NULL,
			version_of bigint(20) unsigned NULL,
			uploaded_by bigint(20) unsigned NULL,
			uploaded_by_name varchar(160) NOT NULL DEFAULT '',
			reviewed_by bigint(20) unsigned NULL,
			created_at datetime NOT NULL,
			reviewed_at datetime NULL,
			PRIMARY KEY  (id),
			KEY project_id (project_id),
			KEY client_id (client_id)
		) $c;",
		'CREATE TABLE ' . pd_table( 'documents' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			client_id bigint(20) unsigned NOT NULL,
			project_id bigint(20) unsigned NULL,
			title varchar(200) NOT NULL,
			kind varchar(20) NOT NULL DEFAULT 'agreement',
			body longtext NOT NULL,
			body_hash char(64) NOT NULL,
			status varchar(30) NOT NULL DEFAULT 'awaiting_signature',
			signature_name varchar(160) NULL,
			signature_image mediumtext NULL,
			signer_user_id bigint(20) unsigned NULL,
			signer_ip varchar(64) NULL,
			signer_agent varchar(400) NULL,
			signed_at datetime NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY client_id (client_id)
		) $c;",
		'CREATE TABLE ' . pd_table( 'payments' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			project_id bigint(20) unsigned NOT NULL,
			client_id bigint(20) unsigned NOT NULL,
			label varchar(160) NOT NULL,
			kind varchar(20) NOT NULL DEFAULT 'milestone',
			amount bigint(20) unsigned NOT NULL,
			amount_paid bigint(20) unsigned NOT NULL DEFAULT 0,
			currency char(3) NOT NULL DEFAULT 'NGN',
			due_date date NULL,
			status varchar(20) NOT NULL DEFAULT 'due',
			paid_at datetime NULL,
			method varchar(120) NOT NULL DEFAULT '',
			external_ref varchar(120) NOT NULL DEFAULT '',
			external_url varchar(255) NOT NULL DEFAULT '',
			proof_asset_id bigint(20) unsigned NULL,
			proof_note text NULL,
			proof_at datetime NULL,
			phase_id bigint(20) unsigned NULL,
			reminder_stage tinyint(3) unsigned NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY project_id (project_id)
		) $c;",
		'CREATE TABLE ' . pd_table( 'messages' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			project_id bigint(20) unsigned NOT NULL,
			author_id bigint(20) unsigned NULL,
			author_role varchar(20) NOT NULL,
			author_name varchar(160) NOT NULL,
			body text NOT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY project_id (project_id)
		) $c;",
		'CREATE TABLE ' . pd_table( 'reviews' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			project_id bigint(20) unsigned NOT NULL,
			client_id bigint(20) unsigned NOT NULL,
			milestone varchar(160) NOT NULL DEFAULT '',
			rating tinyint(3) unsigned NOT NULL,
			body text NOT NULL,
			author_name varchar(160) NOT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY project_id (project_id)
		) $c;",
		'CREATE TABLE ' . pd_table( 'leads' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			company varchar(160) NOT NULL DEFAULT '',
			contact_name varchar(160) NOT NULL,
			email varchar(200) NOT NULL,
			phone varchar(40) NOT NULL DEFAULT '',
			service varchar(40) NOT NULL DEFAULT '',
			budget varchar(60) NOT NULL DEFAULT '',
			message text NULL,
			source varchar(40) NOT NULL DEFAULT 'form',
			status varchar(20) NOT NULL DEFAULT 'new',
			client_id bigint(20) unsigned NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY status (status)
		) $c;",
		'CREATE TABLE ' . pd_table( 'tasks' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			project_id bigint(20) unsigned NULL,
			title varchar(200) NOT NULL,
			details text NULL,
			assignee_id bigint(20) unsigned NULL,
			status varchar(20) NOT NULL DEFAULT 'todo',
			priority varchar(20) NOT NULL DEFAULT 'normal',
			due_date date NULL,
			position int(11) NOT NULL DEFAULT 0,
			created_by bigint(20) unsigned NULL,
			created_at datetime NOT NULL,
			completed_at datetime NULL,
			PRIMARY KEY  (id),
			KEY project_id (project_id),
			KEY assignee_id (assignee_id)
		) $c;",
		'CREATE TABLE ' . pd_table( 'push_subs' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			user_id bigint(20) unsigned NOT NULL,
			endpoint text NOT NULL,
			endpoint_hash char(64) NOT NULL,
			p256dh varchar(255) NOT NULL,
			auth varchar(255) NOT NULL,
			ua varchar(255) NOT NULL DEFAULT '',
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY endpoint_hash (endpoint_hash),
			KEY user_id (user_id)
		) $c;",
		'CREATE TABLE ' . pd_table( 'notifications' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			audience varchar(20) NOT NULL,
			client_id bigint(20) unsigned NULL,
			project_id bigint(20) unsigned NULL,
			channel varchar(20) NOT NULL,
			title varchar(255) NOT NULL,
			body text NOT NULL,
			status varchar(20) NOT NULL,
			recipient varchar(200) NOT NULL DEFAULT '',
			created_at datetime NOT NULL,
			read_at datetime NULL,
			PRIMARY KEY  (id),
			KEY audience_client (audience, client_id)
		) $c;",
	);
}

/** Roles. Owners do everything; project managers run projects but not money, settings or staff. */
function pd_install_roles(): void {
	$owner_caps   = array(
		'read'                => true,
		'pd_manage_projects'  => true,
		'pd_manage_money'     => true,
		'pd_manage_settings'  => true,
		'pd_manage_staff'     => true,
		'pd_override_gates'   => true,
	);
	$manager_caps = array(
		'read'               => true,
		'pd_manage_projects' => true,
	);
	remove_role( 'pd_owner' );
	remove_role( 'pd_manager' );
	remove_role( 'pd_client' );
	add_role( 'pd_owner', 'Project Desk owner', $owner_caps );
	add_role( 'pd_manager', 'Project manager', $manager_caps );
	add_role( 'pd_client', 'Client', array( 'read' => true, 'pd_client_portal' => true ) );
	$admin = get_role( 'administrator' );
	if ( $admin ) {
		foreach ( array_keys( $owner_caps ) as $cap ) {
			$admin->add_cap( $cap );
		}
	}
}

function pd_activate(): void {
	pd_install();
	if ( ! wp_next_scheduled( 'pd_cleanup' ) ) {
		wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'pd_cleanup' );
	}
	if ( ! wp_next_scheduled( 'pd_billing_reminders' ) ) {
		wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'pd_billing_reminders' );
	}
}

function pd_install(): void {
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	foreach ( pd_schema() as $sql ) {
		dbDelta( $sql );
	}
	pd_install_roles();
	pd_storage_dir();
	update_option( 'pd_db_version', PD_DB_VERSION, false );
}

function pd_maybe_upgrade(): void {
	if ( (int) get_option( 'pd_db_version', 0 ) < PD_DB_VERSION ) {
		pd_install();
	}
	if ( ! wp_next_scheduled( 'pd_billing_reminders' ) ) {
		wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'pd_billing_reminders' );
	}
}
