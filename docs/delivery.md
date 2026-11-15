# Delivery

Parts can be delivered from any call or web request.

## For customers
On a new web request, choose **Deliver it** and fill in the delivery details: town, address, and where to leave it or who to ask for. An address is required for delivery. The request page then shows the delivery and its stage, and the usual updates tell them when it is on the way and when it has arrived.

## For staff
- **On a call:** the **Delivery** panel adds a delivery (town, address, notes), shows its stage, and moves it along: asked for, ready to go, out for delivery, delivered. Going out and delivering tell a web customer (and email them if they asked for updates). A delivery can be changed until it's delivered, or removed if it turns out to be a pickup.
- **Deliveries** (in the menu) lists what's still to go, grouped by town, with the ones outside the usual area last, plus what was delivered in the last day.
- **Driver sheet** prints the same list by town with a box to tick for each stop.

## The delivery area
The towns come from the shop's service areas in `src/domain/shop.js`; the town pickers use them. A town outside that list is accepted but flagged ("check with the customer before promising it"), because nobody is refused automatically. Set `delivers: false` there if delivery ever stops. There are no delivery fees, minimums or delivery days in the app; add them to the notes, or tell me what the rule is and it can be built in.
