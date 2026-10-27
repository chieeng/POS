import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { describeApprovalError, formatWhen, useApprovalRequests, withdrawRequest } from './data';
import { useRequestContext } from './context';
import { RequestDetails } from './RequestDetails';
import { StatusTag } from './StatusTag';

/**
 * My requests (APPR-05): what this user asked for, its status and the Owner's note, live.
 * A pending request can be withdrawn; an outdated one needs a new request.
 */
export function MyRequestsPage() {
  const requests = useApprovalRequests();
  const context = useRequestContext();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const withdraw = async (id: string) => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await withdrawRequest(id);
      setNotice('Request withdrawn.');
    } catch (caught) {
      setError(describeApprovalError(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex w-full max-w-[760px] flex-col gap-[14px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pl-[16px]">
      <h1 className="text-[28px] md:text-[30px]">My requests</h1>
      <p className="px-[4px] text-[13.5px] text-neutral-700">
        To ask for a change, open the product (“Request a change”, “Request an adjustment”) or your
        stock-in (“Request a correction”). The Owner decides; you see the answer here.
      </p>
      {notice && (
        <p role="status" className="px-[4px] text-[14px] text-neutral-800">
          {notice}
        </p>
      )}
      {error && <Alert variant="danger">{error}</Alert>}

      {requests.error ? (
        <Alert variant="danger">
          <b>Couldn&apos;t load your requests.</b> Check your connection and reload.
        </Alert>
      ) : requests.loading || context.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : requests.data.length === 0 ? (
        <p className="px-[4px] text-neutral-700">You have not made any requests yet.</p>
      ) : (
        <ul className="flex flex-col gap-[12px]">
          {requests.data.map((request) => {
            const outdated = request.status === 'pending' && context.outdated(request);
            const title = context.title(request);
            return (
              <li
                key={request.id}
                className="flex flex-col gap-[10px] rounded-[30px] bg-surface px-[18px] py-[16px] md:px-[22px]"
              >
                <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[4px]">
                  <Link to={title.to} className="text-[16px] font-semibold">
                    {title.label}
                  </Link>
                  <StatusTag status={request.status} outdated={outdated} />
                  <span className="text-[13px] text-neutral-700">
                    {formatWhen(request.createdAt)}
                  </span>
                </div>
                {outdated && (
                  <Alert variant="warn">
                    <span>
                      <b>Outdated:</b>{' '}
                      {request.type === 'stock_in_correction'
                        ? 'this stock-in was corrected since you asked.'
                        : 'the product changed since you asked.'}{' '}
                      Withdraw this request and make a new one if the change is still needed.
                    </span>
                  </Alert>
                )}
                <RequestDetails request={request} context={context} outdated={outdated} />
                <p className="text-[14px]">
                  <span className="text-neutral-700">Your reason: </span>
                  {request.reason}
                </p>
                {request.ownerNote && (
                  <p className="text-[14px]">
                    <span className="text-neutral-700">Owner&apos;s note: </span>
                    {request.ownerNote}
                  </p>
                )}
                {request.status === 'pending' && (
                  <Button
                    variant="secondary"
                    className="min-h-[44px] self-start px-[18px]"
                    disabled={busyId === request.id}
                    onClick={() => void withdraw(request.id)}
                  >
                    {busyId === request.id ? 'Withdrawing…' : 'Withdraw'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
