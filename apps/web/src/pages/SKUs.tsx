import { useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import type { Sku, Paginated, SkuCreateInput } from "@fbm/shared";
import { CHANNEL_LABELS, SALES_CHANNELS } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { money, num } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { StatusBadge, Tags } from "../components/Badges";
import { Modal } from "../components/Modal";
import { BarcodeScanner } from "../components/BarcodeScanner";
import "./SKUs.css";

const PAGE_SIZE = 25;

const emptySku: SkuCreateInput = {
  sku: "",
  title: "",
  channel: "amazon",
  price: 0,
  status: "active",
};

export function SKUs() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [scanOpen, setScanOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<SkuCreateInput>(emptySku);
  const [scheduleFor, setScheduleFor] = useState<Sku | null>(null);

  const query = useQuery({
    queryKey: ["skus", { search, page }],
    queryFn: () =>
      api.get<Paginated<Sku>>(
        `/skus${qs({ search, page, pageSize: PAGE_SIZE })}`,
      ),
    placeholderData: keepPreviousData,
  });

  const createMut = useMutation({
    mutationFn: (body: SkuCreateInput) => api.post<Sku>("/skus", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skus"] });
      setCreateOpen(false);
      setDraft(emptySku);
    },
  });

  const favMut = useMutation({
    mutationFn: (s: Sku) =>
      api.patch(`/skus/${s.id}`, { favorite: !s.favorite }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skus"] }),
  });

  const scheduleMut = useMutation({
    mutationFn: (vars: { sku: Sku; price: number; start: string; end: string }) =>
      api.post("/schedules", {
        skuId: vars.sku.id,
        type: "single",
        price: vars.price,
        currentPrice: vars.sku.price,
        startDate: vars.start,
        endDate: vars.end,
        timeSlots: [],
        timezone: "America/New_York",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      setScheduleFor(null);
    },
  });

  const data = query.data;
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div>
      <PageHeader
        title="SKUs"
        subtitle="Every listing across your connected channels"
        actions={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => setScanOpen(true)}
            >
              Scan
            </button>
            <button
              className="btn btn-primary"
              onClick={() => setCreateOpen(true)}
            >
              + Add SKU
            </button>
          </>
        }
      />

      <div className="toolbar">
        <input
          className="input grow"
          placeholder="Search SKU, ASIN, or title…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No SKUs yet"
          message="Add a SKU or connect a marketplace to sync listings."
          action={
            <button
              className="btn btn-primary"
              onClick={() => setCreateOpen(true)}
            >
              + Add SKU
            </button>
          }
        />
      ) : (
        <>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th></th>
                  <th>Status</th>
                  <th></th>
                  <th>Product</th>
                  <th className="right">Price</th>
                  <th>Channel</th>
                  <th>Tags</th>
                  <th className="right">Stock</th>
                  <th className="right">30d Sales</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <button
                        className={"star" + (s.favorite ? " on" : "")}
                        onClick={() => favMut.mutate(s)}
                        aria-label="Toggle favorite"
                      >
                        ★
                      </button>
                    </td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td>
                      {s.imageUrl ? (
                        <img className="product-img" src={s.imageUrl} alt="" />
                      ) : (
                        <div className="product-img" />
                      )}
                    </td>
                    <td>
                      <div className="sku-title">{s.title}</div>
                      <div className="sku-codes mono">
                        {s.asin ? `${s.asin} · ` : ""}
                        {s.sku}
                      </div>
                    </td>
                    <td className="right strong">{money(s.price)}</td>
                    <td>
                      <span className="badge badge-neutral">
                        {CHANNEL_LABELS[s.channel]}
                      </span>
                    </td>
                    <td>
                      <Tags tags={s.tags} />
                    </td>
                    <td className="right">{num(s.stock)}</td>
                    <td className="right">{num(s.sales30d)}</td>
                    <td>
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => setScheduleFor(s)}
                      >
                        Schedule
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pager">
            <span className="muted">
              {data.total} SKUs · page {page} / {totalPages}
            </span>
            <div className="pager-btns">
              <button
                className="btn btn-sm btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Prev
              </button>
              <button
                className="btn btn-sm btn-secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      <BarcodeScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={(text) => {
          setSearch(text);
          setPage(1);
        }}
      />

      <Modal
        open={createOpen}
        title="Add SKU"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={createMut.isPending || !draft.sku || !draft.title}
              onClick={() => createMut.mutate(draft)}
            >
              {createMut.isPending ? "Saving…" : "Create"}
            </button>
          </>
        }
      >
        <div className="field">
          <label>SKU</label>
          <input
            className="input"
            value={draft.sku}
            onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Title</label>
          <input
            className="input"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Channel</label>
          <select
            className="select"
            value={draft.channel}
            onChange={(e) =>
              setDraft({ ...draft, channel: e.target.value as Sku["channel"] })
            }
          >
            {SALES_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Price</label>
          <input
            className="input"
            type="number"
            step="0.01"
            value={draft.price}
            onChange={(e) =>
              setDraft({ ...draft, price: Number(e.target.value) })
            }
          />
        </div>
      </Modal>

      <ScheduleModal
        sku={scheduleFor}
        onClose={() => setScheduleFor(null)}
        onSubmit={(price, start, end) =>
          scheduleFor &&
          scheduleMut.mutate({ sku: scheduleFor, price, start, end })
        }
        busy={scheduleMut.isPending}
      />
    </div>
  );
}

function ScheduleModal({
  sku,
  onClose,
  onSubmit,
  busy,
}: {
  sku: Sku | null;
  onClose: () => void;
  onSubmit: (price: number, start: string, end: string) => void;
  busy: boolean;
}) {
  const [price, setPrice] = useState(0);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  return (
    <Modal
      open={!!sku}
      title={sku ? `Schedule price · ${sku.sku}` : ""}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !price || !start}
            onClick={() => onSubmit(price, start, end)}
          >
            {busy ? "Scheduling…" : "Schedule"}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 12 }}>
        Current price {sku ? money(sku.price) : ""}. The new price is applied at
        the start time and reverted at the end time.
      </p>
      <div className="field">
        <label>New price</label>
        <input
          className="input"
          type="number"
          step="0.01"
          onChange={(e) => setPrice(Number(e.target.value))}
        />
      </div>
      <div className="field">
        <label>Start</label>
        <input
          className="input"
          type="datetime-local"
          onChange={(e) => setStart(e.target.value)}
        />
      </div>
      <div className="field">
        <label>End (revert)</label>
        <input
          className="input"
          type="datetime-local"
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>
    </Modal>
  );
}
