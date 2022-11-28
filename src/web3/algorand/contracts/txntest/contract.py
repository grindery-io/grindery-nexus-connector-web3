from pyteal import *


# Create a simple Expression to use later
is_creator = Txn.sender() == Global.creator_address()

# Main router class
router = Router(
    # Name of the contract
    "demo-abi",
    # What to do for each on-complete type when no arguments are passed (bare call)
    BareCallActions(
        # On create only, just approve
        no_op=OnCompleteAction.create_only(Approve()),
        # Always let creator update/delete but only by the creator of this contract
        update_application=OnCompleteAction.always(Return(is_creator)),
        delete_application=OnCompleteAction.always(Return(is_creator)),
        # No local state, dont bother handling it
        # close_out=OnCompleteAction.never(),
        # opt_in=OnCompleteAction.never(),
        # Just be nice, we _must_ provide _something_ for clear state becuase it is its own
        # program and the router needs _something_ to build
        # clear_state=OnCompleteAction.call_only(Approve()),
        clear_state=OnCompleteAction.never(),
    ),
)

@router.method
def txntest(
    amt: abi.Uint64,
    ptxn: abi.PaymentTransaction,
    fee: abi.Uint64,
    *,
    output: abi.Uint64,
):
    """Useless method that just demonstrates specifying a transaction in the method signature"""
    # Transaction types may be specified but aren't part of the application arguments
    # you can get the underlying TxnObject with ptxn.get() and perform all the expected
    # functions on it to get access to the fields

    return Seq(
        Assert(ptxn.get().type_enum() == TxnType.Payment),
        Assert(ptxn.get().amount() == amt.get()),
        Assert(ptxn.get().fee() == fee.get()),
        output.set(ptxn.get().amount()),
    )


if __name__ == "__main__":
    import os
    import json

    path = os.path.dirname(os.path.abspath(__file__))

    # we use compile program here to get the resulting teal code and Contract definition
    # similarly we could use build_program to return the AST for approval/clear and compile it
    # ourselves, but why?
    approval, clear, contract = router.compile_program(
        version=6, optimize=OptimizeOptions(scratch_slots=True)
    )

    # Dump out the contract as json that can be read in by any of the SDKs
    with open(os.path.join(path, "contract.json"), "w") as f:
        f.write(json.dumps(contract.dictify(), indent=2))

    # Write out the approval and clear programs
    with open(os.path.join(path, "approval.teal"), "w") as f:
        f.write(approval)

    with open(os.path.join(path, "clear.teal"), "w") as f:
        f.write(clear)
