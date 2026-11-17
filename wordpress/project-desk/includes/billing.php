<?php
/**
 * Billing: invoices, the automatic deposit invoice, client payment proof and confirming
 * payment. When the InvoiceNaija plugin is active, every invoice is also raised there, so the
 * client gets InvoiceNaija's invoice email (with its pay page and bank details) and its receipt.
 *
 * @package Project_Desk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** True when InvoiceNaija is installed and active on this site. */
function pd_invoicenaija_active(): bool {
	return (bool) apply_filters( 'pd_use_invoicenaija', class_exists( 'INAIJA_Invoices' ) && class_exists( 'INAIJA_Mailer' ) );
}

/**
 * Creates a due invoice for a project and sends it. When $announce_staff is true (the invoice was
 * raised automatically, for a deposit or a milestone), the team is also told it went out.
 * Returns the payment id or an error.
 */
function pd_create_invoice( array $project, string $label, string $kind, int $amount, ?string $due = null, ?int $phase_id = null, bool $announce_staff = false ) {
	global $wpdb;
	if ( $amount <= 0 || '' === $label ) {
		return pd_error( 'Add a label and an amount.' );
	}
	$s = pd_settings();
	if ( ! $due && (int) $s['invoice_due_days'] > 0 ) {
		$due = gmdate( 'Y-m-d', time() + (int) $s['invoice_due_days'] * DAY_IN_SECONDS );
	}
	$wpdb->insert(
		pd_table( 'payments' ),
		array(
			'project_id' => $project['id'],
			'client_id'  => $project['client_id'],
			'label'      => $label,
			'kind'       => pd_one_of( $kind, array( 'deposit', 'milestone', 'balance', 'monthly' ), 'milestone' ),
			'amount'     => $amount,
			'currency'   => $s['currency'],
			'due_date'   => $due,
			'status'     => 'due',
			'phase_id'   => $phase_id ? $phase_id : null,
			'created_at' => pd_now(),
		)
	);
	$payment_id = (int) $wpdb->insert_id;
	pd_issue_invoice( $payment_id, $announce_staff );
	return $payment_id;
}

/**
 * Sends an invoice to the client. With InvoiceNaija: raises the invoice there and emails it
 * from there, keeping the link to its pay page. Without: a branded invoice email from here.
 */
function pd_issue_invoice( int $payment_id, bool $announce_staff = false ): void {
	global $wpdb;
	$payment = pd_get_row( 'payments', $payment_id );
	if ( ! $payment ) {
		return;
	}
	$project = pd_get_row( 'projects', (int) $payment['project_id'] );
	$client  = pd_get_row( 'clients', (int) $payment['client_id'] );
	$s       = pd_settings();
	$due     = $payment['due_date'] ? wp_date( 'j F Y', strtotime( $payment['due_date'] . ' 12:00:00' ) ) : '';

	if ( pd_invoicenaija_active() ) {
		$invoice = pd_invoicenaija_raise( $payment, $project, $client );
		if ( $invoice ) {
			$total = (int) round( 100 * (float) INAIJA_Util::totals( $invoice )['total'] );
			$wpdb->update(
				pd_table( 'payments' ),
				array(
					'external_ref' => (string) $invoice['id'],
					'external_url' => (string) ( $invoice['publicUrl'] ?? '' ),
					'amount'       => $total > 0 ? $total : (int) $payment['amount'],
				),
				array( 'id' => $payment_id )
			);
			$sent = false;
			try {
				$result = INAIJA_Mailer::send_invoice( $invoice );
				$sent   = is_array( $result ) ? ! empty( $result['sent'] ) : (bool) $result;
			} catch ( Throwable $e ) {
				$sent = false;
			}
			pd_notify(
				array(
					array(
						'audience'   => 'client',
						'client_id'  => (int) $payment['client_id'],
						'project_id' => (int) $payment['project_id'],
						'title'      => 'New invoice: ' . $payment['label'],
						'body'       => sprintf( '%s is due%s. Pay from the Payments tab, then send your proof of payment there.', pd_format_money( $total > 0 ? $total : (int) $payment['amount'], $payment['currency'] ), $due ? ' by ' . $due : '' ),
						// InvoiceNaija emailed the invoice; if that failed, send ours instead.
						'channels'   => $sent ? array() : array( 'email' ),
						'email'      => $client['email'] ?? '',
						'link'       => (string) ( $invoice['publicUrl'] ?? $s['portal_url'] ),
						'button'     => 'View and pay invoice',
					),
				)
			);
			if ( $announce_staff ) {
				pd_announce_invoice_to_staff( $payment_id );
			}
			return;
		}
	}

	$body = sprintf( "%s is due%s for %s.", pd_format_money( (int) $payment['amount'], $payment['currency'] ), $due ? ' by ' . $due : '', $project['name'] ?? 'your project' );
	if ( trim( (string) $s['bank_details'] ) ) {
		$body .= "\n\nPay by bank transfer to:\n" . trim( (string) $s['bank_details'] );
	}
	$body .= "\n\nOnce you have paid, upload your proof of payment in the Payments tab of your portal and we will confirm it.";
	pd_notify(
		array(
			array(
				'audience'   => 'client',
				'client_id'  => (int) $payment['client_id'],
				'project_id' => (int) $payment['project_id'],
				'title'      => 'New invoice: ' . $payment['label'],
				'body'       => $body,
				'channels'   => array( 'email' ),
				'email'      => $client['email'] ?? '',
				'button'     => 'Open Payments',
			),
		)
	);
	if ( $announce_staff ) {
		pd_announce_invoice_to_staff( $payment_id );
	}
}

/** Tells the team an automatic invoice has been emailed to the client. */
function pd_announce_invoice_to_staff( int $payment_id ): void {
	$payment = pd_get_row( 'payments', $payment_id );
	if ( ! $payment ) {
		return;
	}
	$project = pd_get_row( 'projects', (int) $payment['project_id'] );
	$client  = pd_get_row( 'clients', (int) $payment['client_id'] );
	pd_notify(
		array(
			array(
				'audience'   => 'staff',
				'client_id'  => (int) $payment['client_id'],
				'project_id' => (int) $payment['project_id'],
				'title'      => 'Invoice sent — ' . $payment['label'],
				'body'       => sprintf( 'The %s invoice for %s was emailed to %s. The client will pay and send proof.', pd_format_money( (int) $payment['amount'], $payment['currency'] ), $project['name'] ?? 'the project', $client['company'] ?? ( $client['email'] ?? 'the client' ) ),
				'channels'   => array( 'email' ),
			),
		)
	);
}

/** Raises the invoice in InvoiceNaija. Returns the saved invoice, or null on failure. */
function pd_invoicenaija_raise( array $payment, ?array $project, ?array $client ): ?array {
	try {
		$cfg   = class_exists( 'INAIJA_Settings' ) ? (array) INAIJA_Settings::get() : array();
		$inv   = (array) ( $cfg['invoice'] ?? array() );
		$today = current_time( 'Y-m-d' );
		$saved = INAIJA_Invoices::save(
			array(
				'id'        => 'inv_pd' . (int) $payment['id'] . '_' . wp_generate_password( 8, false, false ),
				'issueDate' => $today,
				'dueDate'   => $payment['due_date'] ? $payment['due_date'] : gmdate( 'Y-m-d', time() + 7 * DAY_IN_SECONDS ),
				'currency'  => $payment['currency'],
				'client'    => array(
					'name'    => (string) ( $client['company'] ?? '' ),
					'contact' => (string) ( $client['contact_name'] ?? '' ),
					'email'   => (string) ( $client['email'] ?? '' ),
					'phone'   => (string) ( $client['phone'] ?? '' ),
				),
				'items'     => array(
					array(
						'description' => $payment['label'] . ( $project ? "\n" . $project['name'] : '' ),
						'qty'         => 1,
						'unit'        => 'item',
						'unitPrice'   => round( (int) $payment['amount'] / 100, 2 ),
					),
				),
				'vat'       => array(
					// Project invoices carry no VAT unless the setting turns it on.
					'enabled' => ! empty( pd_settings()['invoice_vat'] ),
					'rate'    => isset( $inv['vatRate'] ) ? (float) $inv['vatRate'] : 7.5,
				),
				'notes'     => 'Pay by bank transfer to an account below, then upload your proof of payment. Your client portal: ' . pd_settings()['portal_url'],
				'sentAt'    => current_time( 'mysql' ),
			)
		);
		return is_array( $saved ) && ! empty( $saved['id'] ) ? $saved : null;
	} catch ( Throwable $e ) {
		return null;
	}
}

/**
 * Raises the deposit invoice for a project once: price × deposit %, when a price is set and no
 * deposit invoice exists yet. Returns the payment id, or 0 when none was needed.
 */
function pd_create_deposit_invoice( int $project_id ): int {
	global $wpdb;
	$project = pd_get_row( 'projects', $project_id );
	if ( ! $project || (int) $project['price'] <= 0 || (int) $project['deposit_percent'] <= 0 ) {
		return 0;
	}
	$exists = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . pd_table( 'payments' ) . " WHERE project_id = %d AND kind = 'deposit' AND status != 'cancelled'", $project_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	if ( $exists ) {
		return 0;
	}
	$pct    = (int) $project['deposit_percent'];
	$amount = (int) round( (int) $project['price'] * $pct / 100 );
	$id     = pd_create_invoice( $project, sprintf( 'Deposit (%d%%) — %s', $pct, $project['name'] ), 'deposit', $amount, null, null, true );
	return is_wp_error( $id ) ? 0 : (int) $id;
}

/**
 * Raises the invoice for a billing-milestone phase once it completes: price × the phase's payment
 * percentage, when a price is set and no invoice for this phase exists yet. Returns the payment id,
 * or 0 when none was needed.
 */
function pd_create_milestone_invoice( int $phase_id ): int {
	global $wpdb;
	$phase = pd_get_row( 'phases', $phase_id );
	if ( ! $phase || (int) $phase['bill_percent'] <= 0 ) {
		return 0;
	}
	$project = pd_get_row( 'projects', (int) $phase['project_id'] );
	if ( ! $project || (int) $project['price'] <= 0 ) {
		return 0;
	}
	$exists = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . pd_table( 'payments' ) . " WHERE phase_id = %d AND status != 'cancelled'", $phase_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	if ( $exists ) {
		return 0;
	}
	$pct    = (int) $phase['bill_percent'];
	$amount = (int) round( (int) $project['price'] * $pct / 100 );
	$id     = pd_create_invoice( $project, sprintf( '%s payment (%d%%)', $phase['name'], $pct ), 'milestone', $amount, null, $phase_id, true );
	return is_wp_error( $id ) ? 0 : (int) $id;
}

/** Raises the invoice for every completed billing-milestone phase that has none yet. */
function pd_bill_completed_milestones( int $project_id ): void {
	global $wpdb;
	$ids = $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM ' . pd_table( 'phases' ) . " WHERE project_id = %d AND bill_percent > 0 AND status = 'completed' ORDER BY position ASC", $project_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	foreach ( $ids as $id ) {
		pd_create_milestone_invoice( (int) $id );
	}
}

/** True when an earlier completed billing-milestone phase has an invoice that is not yet paid. */
function pd_milestone_blocks_phase( int $project_id, int $position ): ?string {
	global $wpdb;
	$row = $wpdb->get_row( $wpdb->prepare(
		'SELECT ph.name, pm.status FROM ' . pd_table( 'phases' ) . ' ph JOIN ' . pd_table( 'payments' ) . ' pm ON pm.phase_id = ph.id'
		. " WHERE ph.project_id = %d AND ph.position < %d AND ph.bill_percent > 0 AND pm.status != 'paid' AND pm.status != 'cancelled' ORDER BY ph.position DESC LIMIT 1",
		$project_id,
		$position
	), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	return $row ? (string) $row['name'] : null;
}

/**
 * Marks a payment paid, once. $source 'invoicenaija' means InvoiceNaija already banked it and
 * sent its receipt; otherwise the payment is recorded there too (which sends its receipt), or a
 * receipt email goes from here. Starts the work when this was the deposit.
 */
function pd_mark_payment_paid( int $payment_id, string $method = 'Bank transfer', string $source = 'staff' ): bool {
	global $wpdb;
	$payment = pd_get_row( 'payments', $payment_id );
	if ( ! $payment || 'paid' === $payment['status'] ) {
		return false;
	}
	$changed = $wpdb->update(
		pd_table( 'payments' ),
		array( 'status' => 'paid', 'paid_at' => pd_now(), 'method' => $method ? $method : 'Bank transfer', 'amount_paid' => (int) $payment['amount'] ),
		array( 'id' => $payment_id, 'status' => $payment['status'] )
	);
	if ( ! $changed ) {
		return false;
	}

	$receipt_sent = false;
	if ( 'invoicenaija' === $source ) {
		$receipt_sent = true;
	} elseif ( $payment['external_ref'] && pd_invoicenaija_active() ) {
		$receipt_sent = pd_invoicenaija_record( $payment, $method );
	}

	$client = pd_get_row( 'clients', (int) $payment['client_id'] );
	pd_notify(
		array(
			array(
				'audience'   => 'client',
				'client_id'  => (int) $payment['client_id'],
				'project_id' => (int) $payment['project_id'],
				'title'      => 'Payment received: ' . $payment['label'],
				'body'       => sprintf( 'We have confirmed your payment of %s. Thank you!', pd_format_money( (int) $payment['amount'], $payment['currency'] ) ) . ( $receipt_sent ? ' Your receipt has been emailed to you.' : '' ),
				'channels'   => $receipt_sent ? array() : array( 'email' ),
				'email'      => $client['email'] ?? '',
			),
		)
	);
	pd_maybe_unlock_work( (int) $payment['project_id'] );
	if ( ! empty( $payment['phase_id'] ) ) {
		pd_advance_after_milestone( (int) $payment['phase_id'] );
	}
	return true;
}

/**
 * Records a part-payment against an invoice. When the running total reaches the invoice amount the
 * invoice is marked fully paid (receipt, milestone advance, InvoiceNaija record); otherwise the
 * balance is carried and the client is told what is left.
 */
function pd_record_part_payment( int $payment_id, int $amount, string $method = 'Bank transfer' ) {
	global $wpdb;
	$payment = pd_get_row( 'payments', $payment_id );
	if ( ! $payment ) {
		return pd_error( 'Payment not found.', 404 );
	}
	if ( 'paid' === $payment['status'] || 'cancelled' === $payment['status'] ) {
		return pd_error( 'This invoice is already settled.' );
	}
	if ( $amount < 1 ) {
		return pd_error( 'Enter the amount received.' );
	}
	$already   = (int) $payment['amount_paid'];
	$total     = (int) $payment['amount'];
	$remaining = max( 0, $total - $already );
	if ( $amount >= $remaining ) {
		// Settles the invoice: run the normal full-payment flow.
		pd_mark_payment_paid( $payment_id, $method );
		return array( 'status' => 'paid', 'amountPaid' => $total, 'remaining' => 0 );
	}
	$new_paid = $already + $amount;
	$wpdb->update(
		pd_table( 'payments' ),
		array( 'amount_paid' => $new_paid, 'method' => $method ? $method : 'Bank transfer' ),
		array( 'id' => $payment_id )
	);
	$client = pd_get_row( 'clients', (int) $payment['client_id'] );
	pd_notify(
		array(
			array(
				'audience'   => 'client',
				'client_id'  => (int) $payment['client_id'],
				'project_id' => (int) $payment['project_id'],
				'title'      => 'Part-payment received: ' . $payment['label'],
				'body'       => sprintf(
					'We have recorded %s towards %s. That leaves a balance of %s.',
					pd_format_money( $amount, $payment['currency'] ),
					$payment['label'],
					pd_format_money( $total - $new_paid, $payment['currency'] )
				),
				'channels'   => array( 'email' ),
				'email'      => $client['email'] ?? '',
			),
		)
	);
	return array( 'status' => 'due', 'amountPaid' => $new_paid, 'remaining' => $total - $new_paid );
}

/**
 * Once a milestone invoice is paid, starts the next queued phase if the project is otherwise idle,
 * so the work that was held for payment carries on automatically.
 */
function pd_advance_after_milestone( int $phase_id ): void {
	global $wpdb;
	$phase = pd_get_row( 'phases', $phase_id );
	if ( ! $phase ) {
		return;
	}
	$t       = pd_table( 'phases' );
	$project_id = (int) $phase['project_id'];
	$ongoing = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$t} WHERE project_id = %d AND status = 'ongoing'", $project_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	if ( $ongoing ) {
		return;
	}
	$next = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE project_id = %d AND position > %d AND status = 'queued' ORDER BY position ASC LIMIT 1", $project_id, (int) $phase['position'] ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	if ( ! $next ) {
		return;
	}
	$wpdb->update( $t, array( 'status' => 'ongoing', 'started_at' => pd_now() ), array( 'id' => $next['id'] ) );
	$project = pd_get_row( 'projects', $project_id );
	$client  = pd_get_row( 'clients', (int) $project['client_id'] );
	pd_notify(
		array(
			array(
				'audience'   => 'client',
				'client_id'  => (int) $project['client_id'],
				'project_id' => $project_id,
				'title'      => 'Payment received — next up: ' . $next['name'],
				'body'       => sprintf( 'Thank you. Work on %s continues now with: %s.', $project['name'], $next['name'] ),
				'channels'   => array( 'email' ),
				'email'      => $client['email'] ?? '',
			),
			array(
				'audience'   => 'staff',
				'client_id'  => (int) $project['client_id'],
				'project_id' => $project_id,
				'title'      => 'Milestone paid — ' . $project['name'],
				'body'       => sprintf( 'Payment received. "%s" is now in progress.', $next['name'] ),
				'channels'   => array( 'email' ),
			),
		)
	);
}

/** Records the payment against the InvoiceNaija invoice, which emails the receipt. */
function pd_invoicenaija_record( array $payment, string $method ): bool {
	static $busy = false;
	if ( $busy ) {
		return false;
	}
	$busy = true;
	try {
		$invoice = INAIJA_DB::get( $payment['external_ref'], 'invoice' );
		if ( ! $invoice ) {
			return false;
		}
		$balance = (float) INAIJA_Util::totals( $invoice )['balance'];
		if ( $balance <= 0 ) {
			return true;
		}
		$GLOBALS['pd_recording_invoicenaija'] = true;
		INAIJA_Invoices::record_payment(
			$payment['external_ref'],
			array(
				'amount'    => $balance,
				'method'    => 'bank_transfer',
				'reference' => 'Project Desk payment #' . (int) $payment['id'],
				'note'      => $method,
			),
			$payment['proof_at'] ? 'bank_proof' : 'manual'
		);
		return true;
	} catch ( Throwable $e ) {
		return false;
	} finally {
		$GLOBALS['pd_recording_invoicenaija'] = false;
		$busy                                 = false;
	}
}

/** InvoiceNaija banked a payment (on its pay page or in its admin): mark ours paid to match. */
function pd_on_invoicenaija_payment( $invoice, $receipt = null, $payment = null ): void {
	global $wpdb;
	if ( ! empty( $GLOBALS['pd_recording_invoicenaija'] ) || ! is_array( $invoice ) || empty( $invoice['id'] ) ) {
		return;
	}
	if ( 'paid' !== ( $invoice['status'] ?? '' ) ) {
		return;
	}
	$id = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . pd_table( 'payments' ) . " WHERE external_ref = %s AND status != 'paid'", (string) $invoice['id'] ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	if ( $id ) {
		$method = is_array( $payment ) && ! empty( $payment['method'] ) ? ucwords( str_replace( '_', ' ', (string) $payment['method'] ) ) : 'Bank transfer';
		pd_mark_payment_paid( $id, $method, 'invoicenaija' );
	}
}

/** The client sends proof of payment (an uploaded file and/or a note) for staff to confirm. */
function pd_submit_payment_proof( int $payment_id, int $client_id, int $asset_id, string $note ) {
	global $wpdb;
	$payment = pd_get_row( 'payments', $payment_id );
	if ( ! $payment || (int) $payment['client_id'] !== $client_id ) {
		return pd_error( 'Invoice not found.', 404 );
	}
	if ( 'due' !== $payment['status'] ) {
		return pd_error( 'This invoice is not awaiting payment.', 409 );
	}
	if ( $asset_id ) {
		$asset = pd_get_row( 'assets', $asset_id );
		if ( ! $asset || (int) $asset['project_id'] !== (int) $payment['project_id'] ) {
			return pd_error( 'Upload the proof of payment first.' );
		}
	}
	if ( ! $asset_id && mb_strlen( $note ) < 3 ) {
		return pd_error( 'Attach your proof of payment, or add the transfer reference.' );
	}
	$wpdb->update(
		pd_table( 'payments' ),
		array( 'proof_asset_id' => $asset_id ? $asset_id : null, 'proof_note' => $note, 'proof_at' => pd_now() ),
		array( 'id' => $payment_id )
	);
	$client  = pd_get_row( 'clients', $client_id );
	$project = pd_get_row( 'projects', (int) $payment['project_id'] );
	pd_notify(
		array(
			array(
				'audience'   => 'staff',
				'client_id'  => $client_id,
				'project_id' => (int) $payment['project_id'],
				'title'      => 'Payment proof to confirm — ' . $payment['label'],
				'body'       => sprintf( '%s sent proof of payment for %s (%s) on %s.%s Open it to confirm the payment.', $client['company'] ?? 'A client', $payment['label'], pd_format_money( (int) $payment['amount'], $payment['currency'] ), $project['name'] ?? 'their project', $note ? ' Note: ' . $note : '' ),
				'channels'   => array( 'email', 'whatsapp' ),
				'link'       => pd_app_link( 'projects/' . (int) $payment['project_id'], array( 'tab' => 'money' ) ),
				'button'     => 'Confirm payment',
			),
		)
	);
	return true;
}

/** True when the client has signed an agreement that covers this project. */
function pd_agreement_signed( int $project_id ): bool {
	global $wpdb;
	$project = pd_get_row( 'projects', $project_id );
	if ( ! $project ) {
		return false;
	}
	return (bool) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . pd_table( 'documents' ) . " WHERE client_id = %d AND (project_id = %d OR project_id IS NULL) AND kind = 'agreement' AND status = 'signed'", $project['client_id'], $project_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
}

/**
 * Daily: reminds clients about invoices that are still due. One reminder once the invoice is at
 * least 3 days old, a second once it is at least 7 days old, and no more after that. Invoices with
 * proof already submitted (awaiting the team's confirmation) are left alone.
 *
 * @param int $now_ts Current time; overridable for testing.
 * @return int How many reminders were sent.
 */
function pd_send_billing_reminders( int $now_ts = 0 ): int {
	global $wpdb;
	$now_ts = $now_ts ? $now_ts : time();
	$rows   = $wpdb->get_results(
		"SELECT * FROM " . pd_table( 'payments' ) . " WHERE status = 'due' AND reminder_stage < 2 AND proof_at IS NULL ORDER BY id ASC",
		ARRAY_A
	); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	$sent = 0;
	foreach ( $rows as $payment ) {
		$age_days = (int) floor( ( $now_ts - (int) strtotime( (string) $payment['created_at'] . ' UTC' ) ) / DAY_IN_SECONDS );
		$stage    = (int) $payment['reminder_stage'];
		$target   = 0 === $stage ? 3 : 7;
		if ( $age_days < $target ) {
			continue;
		}
		$client  = pd_get_row( 'clients', (int) $payment['client_id'] );
		$project = pd_get_row( 'projects', (int) $payment['project_id'] );
		if ( ! $client ) {
			$wpdb->update( pd_table( 'payments' ), array( 'reminder_stage' => $stage + 1 ), array( 'id' => $payment['id'] ) );
			continue;
		}
		$s    = pd_settings();
		$due  = $payment['due_date'] ? wp_date( 'j F Y', strtotime( $payment['due_date'] . ' 12:00:00' ) ) : '';
		$body = sprintf(
			'This is a friendly reminder that your invoice "%s" for %s%s is still outstanding.',
			$payment['label'],
			pd_format_money( (int) $payment['amount'], $payment['currency'] ),
			$due ? ' (due ' . $due . ')' : ''
		);
		if ( $payment['external_url'] ) {
			$body .= "\n\nYou can pay it here: " . $payment['external_url'];
		} elseif ( trim( (string) $s['bank_details'] ) ) {
			$body .= "\n\nPay by bank transfer to:\n" . trim( (string) $s['bank_details'] );
		}
		$body .= "\n\nOnce you have paid, upload your proof of payment in the Payments tab of your portal. If you have already paid, please ignore this.";
		pd_notify(
			array(
				array(
					'audience'   => 'client',
					'client_id'  => (int) $payment['client_id'],
					'project_id' => (int) $payment['project_id'],
					'title'      => ( 7 === $target ? 'Second reminder: ' : 'Reminder: ' ) . $payment['label'],
					'body'       => $body,
					'channels'   => array( 'email' ),
					'email'      => $client['email'] ?? '',
					'link'       => $payment['external_url'] ? (string) $payment['external_url'] : (string) $s['portal_url'],
					'button'     => $payment['external_url'] ? 'View and pay invoice' : 'Open Payments',
				),
			)
		);
		$wpdb->update( pd_table( 'payments' ), array( 'reminder_stage' => $stage + 1 ), array( 'id' => $payment['id'] ) );
		++$sent;
	}
	return $sent;
}
