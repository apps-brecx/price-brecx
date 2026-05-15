import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Warehouse, Plus, ChevronDown, ChevronRight, Truck } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatNumber, formatDate, cn } from '@/lib/utils';
import { MarketplacePill } from '@/components/ui/MarketplacePill';

type Shipment = {
  id: string;
  shipmentNumber: string;
  origin: string;
  destination: string;
  carrier: string;
  quantity: number;
  status: string;
  placedAt: string;
  estimatedArrival?: string | null;
};
type InventoryEntry = {
  id: string;
  warehouseId: string;
  warehouseName: string;
  onHand: number;
  reserved: number;
  incoming: number;
  shipments: Shipment[];
};
type ProductLite = { id: string; name: string };
type ProductInv = {
  id: string;
  name: string;
  inventory: InventoryEntry[];
  skus: { id: string; sku: string; listings: { id: string; stockAvailable: number; connection: { marketplace: string } }[] }[];
};

export default function Inventory() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState<ProductLite | null>(null);
  const [shipmentFor, setShipmentFor] = useState<InventoryEntry | null>(null);

  const { data, isLoading } = useQuery<ProductInv[]>({
    queryKey: ['inventory'],
    queryFn: () => api('/api/inventory'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => toast.success('Sync triggered')}
        >
          Sync warehouse
        </button>
      </div>

      {isLoading ? (
        <div className="card p-6 text-sm text-ink-3">Loading…</div>
      ) : !data || data.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Warehouse}
            title="No inventory tracked yet"
            description="Inventory shows once you create products and warehouse records. Connect Nineyard or add manually."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((p) => {
            const isOpen = expanded.has(p.id);
            const totalOnHand = p.inventory.reduce((a, w) => a + w.onHand, 0);
            const totalIncoming = p.inventory.reduce((a, w) => a + w.incoming, 0);
            return (
              <div key={p.id} className="card overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    className="text-ink-3"
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                        return next;
                      })
                    }
                  >
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <div className="flex-1">
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-[12px] text-ink-3">
                      {formatNumber(totalOnHand)} on hand · {formatNumber(totalIncoming)} incoming · {p.skus.length} SKU(s)
                    </div>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setAddOpen({ id: p.id, name: p.name })}
                  >
                    <Plus size={13} /> Add warehouse
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t" style={{ borderColor: 'var(--border)' }}>
                    {p.inventory.length === 0 ? (
                      <EmptyState icon={Warehouse} title="No warehouse data" description="Add a warehouse to track stock for this product." />
                    ) : (
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Warehouse</th>
                            <th>On hand</th>
                            <th>Reserved</th>
                            <th>Incoming</th>
                            <th>Shipments</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.inventory.map((w) => (
                            <tr key={w.id}>
                              <td>
                                <div className="font-medium">{w.warehouseName}</div>
                                <div className="mono text-[11.5px] text-ink-3">{w.warehouseId}</div>
                              </td>
                              <td>{formatNumber(w.onHand)}</td>
                              <td>{formatNumber(w.reserved)}</td>
                              <td>{formatNumber(w.incoming)}</td>
                              <td>
                                {w.shipments.length === 0 ? (
                                  <span className="text-ink-4">—</span>
                                ) : (
                                  <div className="space-y-1">
                                    {w.shipments.slice(0, 2).map((s) => (
                                      <ShipmentChip key={s.id} s={s} />
                                    ))}
                                    {w.shipments.length > 2 && (
                                      <span className="text-[11.5px] text-ink-3">+{w.shipments.length - 2} more</span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td>
                                <button className="btn btn-ghost btn-sm" onClick={() => setShipmentFor(w)}>
                                  <Truck size={13} /> Add shipment
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {p.skus.length > 0 && (
                      <div className="border-t p-4" style={{ borderColor: 'var(--border)' }}>
                        <div className="mb-2 text-[12px] font-semibold text-ink-2">Marketplace stock</div>
                        <div className="flex flex-wrap gap-2">
                          {p.skus.flatMap((s) =>
                            s.listings.map((l) => (
                              <div key={l.id} className="chip">
                                <MarketplacePill id={l.connection.marketplace} />
                                <span className="ml-1.5">{formatNumber(l.stockAvailable)}</span>
                              </div>
                            )),
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {addOpen && (
        <AddWarehouseModal
          product={addOpen}
          onClose={() => setAddOpen(null)}
          onCreated={() => qc.invalidateQueries({ queryKey: ['inventory'] })}
        />
      )}
      {shipmentFor && (
        <AddShipmentModal
          inv={shipmentFor}
          onClose={() => setShipmentFor(null)}
          onCreated={() => qc.invalidateQueries({ queryKey: ['inventory'] })}
        />
      )}
    </div>
  );
}

function ShipmentChip({ s }: { s: Shipment }) {
  const color =
    s.status === 'DELIVERED'
      ? 'chip-success'
      : s.status === 'IN_TRANSIT' || s.status === 'AT_CUSTOMS'
      ? 'chip-warning'
      : s.status === 'CANCELLED'
      ? 'chip-danger'
      : 'chip';
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className={cn('chip', color)}>{s.status.replace('_', ' ').toLowerCase()}</span>
      <span className="mono text-ink-3">{s.shipmentNumber}</span>
      <span className="text-ink-3">· {formatNumber(s.quantity)} units</span>
      {s.estimatedArrival && <span className="text-ink-3">· ETA {formatDate(s.estimatedArrival)}</span>}
    </div>
  );
}

function AddWarehouseModal({ product, onClose, onCreated }: { product: ProductLite; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    warehouseId: '',
    warehouseName: '',
    onHand: '0',
    reserved: '0',
    incoming: '0',
  });
  const m = useMutation({
    mutationFn: () =>
      api('/api/inventory', {
        method: 'POST',
        json: {
          productId: product.id,
          warehouseId: form.warehouseId,
          warehouseName: form.warehouseName,
          onHand: Number(form.onHand),
          reserved: Number(form.reserved),
          incoming: Number(form.incoming),
        },
      }),
    onSuccess: () => {
      toast.success('Inventory saved');
      onCreated();
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Inventory — ${product.name}`}
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!form.warehouseId || !form.warehouseName || m.isPending}
            onClick={() => m.mutate()}
          >
            Save
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Warehouse ID</label>
          <input className="input" value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} />
        </div>
        <div>
          <label className="label">Warehouse name</label>
          <input className="input" value={form.warehouseName} onChange={(e) => setForm({ ...form, warehouseName: e.target.value })} />
        </div>
        <div>
          <label className="label">On hand</label>
          <input className="input" type="number" value={form.onHand} onChange={(e) => setForm({ ...form, onHand: e.target.value })} />
        </div>
        <div>
          <label className="label">Reserved</label>
          <input className="input" type="number" value={form.reserved} onChange={(e) => setForm({ ...form, reserved: e.target.value })} />
        </div>
        <div>
          <label className="label">Incoming</label>
          <input className="input" type="number" value={form.incoming} onChange={(e) => setForm({ ...form, incoming: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}

function AddShipmentModal({ inv, onClose, onCreated }: { inv: InventoryEntry; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    shipmentNumber: '',
    origin: '',
    destination: inv.warehouseName,
    carrier: '',
    quantity: '',
    status: 'PLACED' as 'PLACED' | 'IN_TRANSIT' | 'AT_CUSTOMS' | 'DELIVERED' | 'CANCELLED',
    placedAt: new Date().toISOString().slice(0, 16),
    estimatedArrival: '',
  });
  const m = useMutation({
    mutationFn: () =>
      api('/api/inventory/shipments', {
        method: 'POST',
        json: {
          inventoryId: inv.id,
          shipmentNumber: form.shipmentNumber,
          origin: form.origin,
          destination: form.destination,
          carrier: form.carrier,
          quantity: Number(form.quantity),
          status: form.status,
          placedAt: new Date(form.placedAt).toISOString(),
          estimatedArrival: form.estimatedArrival ? new Date(form.estimatedArrival).toISOString() : undefined,
        },
      }),
    onSuccess: () => {
      toast.success('Shipment created');
      onCreated();
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Shipment to ${inv.warehouseName}`}
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={!form.quantity || !form.shipmentNumber || m.isPending} onClick={() => m.mutate()}>
            Save
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Shipment #</label>
          <input className="input" value={form.shipmentNumber} onChange={(e) => setForm({ ...form, shipmentNumber: e.target.value })} />
        </div>
        <div>
          <label className="label">Carrier</label>
          <input className="input" value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} />
        </div>
        <div>
          <label className="label">Origin</label>
          <input className="input" value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} />
        </div>
        <div>
          <label className="label">Destination</label>
          <input className="input" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} />
        </div>
        <div>
          <label className="label">Quantity</label>
          <input className="input" type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as any })}>
            {['PLACED', 'IN_TRANSIT', 'AT_CUSTOMS', 'DELIVERED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Placed at</label>
          <input className="input" type="datetime-local" value={form.placedAt} onChange={(e) => setForm({ ...form, placedAt: e.target.value })} />
        </div>
        <div>
          <label className="label">ETA</label>
          <input className="input" type="datetime-local" value={form.estimatedArrival} onChange={(e) => setForm({ ...form, estimatedArrival: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}
