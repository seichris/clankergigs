module gh_bounties::gh_bounties {
  use sui::balance::{Self, Balance};
  use sui::clock::Clock;
  use sui::coin::{Self, Coin};
  use sui::event;
  use sui::object::{Self, ID, UID};
  use sui::sui::SUI;
  use sui::transfer;
  use sui::tx_context::{Self, TxContext};
  use std::string::String;

  const STATUS_OPEN: u8 = 0;
  const STATUS_CLOSED: u8 = 2;

  const E_NOT_ADMIN: u64 = 1;
  const E_NOT_FUNDER: u64 = 2;
  const E_WRONG_BOUNTY: u64 = 3;
  const E_LOCKED: u64 = 4;
  const E_INSUFFICIENT_ESCROW: u64 = 5;
  const E_CLOSED: u64 = 6;

  /// Shared bounty object anyone can fund. Admin is initially the bounty creator.
  struct Bounty has key {
    id: UID,
    repo: String,
    issue_number: u64,
    issue_url: String,
    admin: address,
    status: u8,
    escrow: Balance<SUI>,
  }

  /// Receipt representing a single funding contribution and its lock time.
  /// Refunds require presenting this receipt.
  struct FundingReceipt has key, store {
    id: UID,
    bounty_id: ID,
    funder: address,
    amount_mist: u64,
    locked_until_ms: u64,
  }

  /// Minimal claim object. For hackathon scope, the claim URL is stored on-chain,
  /// and authorization is handled socially/off-chain (similar to the EVM flow),
  /// with future work to add zkLogin/sponsored tx and admin-gated payout rules.
  struct Claim has key, store {
    id: UID,
    bounty_id: ID,
    claimer: address,
    claim_url: String,
    created_ms: u64,
  }

  /// Events (must be `copy, drop`): do not include `String` fields.
  struct BountyCreated has copy, drop {
    bounty_id: ID,
    issue_number: u64,
    admin: address,
  }

  struct BountyFunded has copy, drop {
    bounty_id: ID,
    receipt_id: ID,
    funder: address,
    amount_mist: u64,
    locked_until_ms: u64,
  }

  struct ClaimSubmitted has copy, drop {
    bounty_id: ID,
    claim_id: ID,
    claimer: address,
  }

  struct Payout has copy, drop {
    bounty_id: ID,
    recipient: address,
    amount_mist: u64,
  }

  struct Refund has copy, drop {
    bounty_id: ID,
    funder: address,
    amount_mist: u64,
  }

  public fun id(b: &Bounty): ID { object::id(b) }

  public entry fun create_bounty(
    repo: String,
    issue_number: u64,
    issue_url: String,
    ctx: &mut TxContext
  ) {
    let admin = tx_context::sender(ctx);
    let bounty = Bounty {
      id: object::new(ctx),
      repo,
      issue_number,
      issue_url,
      admin,
      status: STATUS_OPEN,
      escrow: balance::zero<SUI>(),
    };
    let bounty_id = object::id(&bounty);
    event::emit(BountyCreated { bounty_id, issue_number, admin });
    transfer::share_object(bounty);
  }

  public entry fun close_bounty(bounty: &mut Bounty, ctx: &mut TxContext) {
    assert!(tx_context::sender(ctx) == bounty.admin, E_NOT_ADMIN);
    bounty.status = STATUS_CLOSED;
  }

  public entry fun fund_bounty(
    bounty: &mut Bounty,
    payment: Coin<SUI>,
    lock_seconds: u64,
    clock: &Clock,
    ctx: &mut TxContext
  ) {
    assert!(bounty.status == STATUS_OPEN, E_CLOSED);
    let funder = tx_context::sender(ctx);
    let amount_mist = coin::value(&payment);
    let now = sui::clock::timestamp_ms(clock);
    let locked_until_ms = now + (lock_seconds * 1000);

    balance::join(&mut bounty.escrow, coin::into_balance(payment));

    let receipt = FundingReceipt {
      id: object::new(ctx),
      bounty_id: object::id(bounty),
      funder,
      amount_mist,
      locked_until_ms,
    };

    let receipt_id = object::id(&receipt);
    event::emit(BountyFunded { bounty_id: receipt.bounty_id, receipt_id, funder, amount_mist, locked_until_ms });
    transfer::transfer(receipt, funder);
  }

  public entry fun submit_claim(
    bounty: &Bounty,
    claim_url: String,
    clock: &Clock,
    ctx: &mut TxContext
  ) {
    let claimer = tx_context::sender(ctx);
    let now = sui::clock::timestamp_ms(clock);
    let claim = Claim {
      id: object::new(ctx),
      bounty_id: object::id(bounty),
      claimer,
      claim_url,
      created_ms: now,
    };
    let claim_id = object::id(&claim);
    event::emit(ClaimSubmitted { bounty_id: object::id(bounty), claim_id, claimer });
    transfer::transfer(claim, claimer);
  }

  public entry fun payout(
    bounty: &mut Bounty,
    recipient: address,
    amount_mist: u64,
    ctx: &mut TxContext
  ) {
    assert!(tx_context::sender(ctx) == bounty.admin, E_NOT_ADMIN);
    assert!(bounty.status == STATUS_OPEN, E_CLOSED);
    assert!(balance::value(&bounty.escrow) >= amount_mist, E_INSUFFICIENT_ESCROW);

    let taken = balance::split(&mut bounty.escrow, amount_mist);
    let coin_out = coin::from_balance(taken, ctx);
    event::emit(Payout { bounty_id: object::id(bounty), recipient, amount_mist });
    transfer::transfer(coin_out, recipient);
  }

  public entry fun refund(
    bounty: &mut Bounty,
    receipt: FundingReceipt,
    clock: &Clock,
    ctx: &mut TxContext
  ) {
    let sender = tx_context::sender(ctx);
    assert!(sender == receipt.funder, E_NOT_FUNDER);
    assert!(object::id(bounty) == receipt.bounty_id, E_WRONG_BOUNTY);
    assert!(bounty.status == STATUS_OPEN, E_CLOSED);

    let now = sui::clock::timestamp_ms(clock);
    assert!(now >= receipt.locked_until_ms, E_LOCKED);

    assert!(balance::value(&bounty.escrow) >= receipt.amount_mist, E_INSUFFICIENT_ESCROW);

    let taken = balance::split(&mut bounty.escrow, receipt.amount_mist);
    let coin_out = coin::from_balance(taken, ctx);
    event::emit(Refund { bounty_id: receipt.bounty_id, funder: sender, amount_mist: receipt.amount_mist });
    transfer::transfer(coin_out, sender);
    // receipt is consumed
  }
}
