export type ExceptionSopSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  steps?: string[];
  table?: {
    columns: string[];
    rows: string[][];
  };
};

export const EXCEPTION_SOP_LINK = 'https://ob-punch-mco.vercel.app/exception';
export const EXCEPTION_SOP_PIN = '6666';

export const EXCEPTION_SOP_SECTIONS: ExceptionSopSection[] = [
  {
    title: '1. Purpose',
    paragraphs: [
      'This SOP standardizes the full picking exception process from discovery, creation, counting, processing, inventory adjustment, responsibility assignment, and final closeout. It reduces missed exception steps, defines role responsibilities, and helps maintain order processing efficiency and inventory data accuracy.'
    ]
  },
  {
    title: '2. Scope',
    paragraphs: [
      'This SOP applies to picking exceptions that occur during picking, verification, Rebin, inventory counting, and exception closeout, including but not limited to:'
    ],
    bullets: [
      'Under-picked items',
      'Short-picked items',
      'Wrong item picked',
      'Missing item found during packing',
      'Quantity discrepancy at the original picked location',
      'Exceptions requiring replenishment from another location'
    ]
  },
  {
    title: '3. Roles and Responsibilities',
    table: {
      columns: ['Role', 'Responsibilities'],
      rows: [
        ['Lead', 'Creates the exception report, updates exception progress, and coordinates counting and follow-up actions.'],
        ['Counter', 'Verifies the inventory quantity at the original picked location and enters System Qty, Actual, and Count By USID.'],
        ['Packer / Rebin', 'Reports shortages, wrong items, or other exceptions found during packing or Rebin.'],
        ['Admin', 'Reviews the exception result, confirms inventory adjustment completion, assigns responsibility, and closes the exception.']
      ]
    }
  },
  {
    title: '4. Exception Status Definitions',
    table: {
      columns: ['Status', 'Definition'],
      rows: [
        ['Created', 'The exception has been created. Counting may not be complete.'],
        ['In Progress', 'The exception is still under investigation or in process.'],
        ['Counted', 'System quantity and actual quantity have been entered, but operator or counter information is incomplete.'],
        ['Pending Adjustment', 'Extra Taken or Borrowed Location has been selected, but the inventory adjustment is not complete.'],
        ['Short Picked', 'The short pick has been confirmed, no stock is available for replenishment, and the order cannot be completed at the original quantity.'],
        ['Resolved', 'The operational action is complete and waiting for Admin final closeout.'],
        ['Cancel', 'The exception has been canceled and will not be processed further.']
      ]
    }
  },
  {
    title: '5. Exception Creation Process',
    paragraphs: [
      'When a Packer, Rebin operator, or other operator finds a picking exception, the Lead must create an exception report as follows:',
      'Count By USID is not required when the exception is first created.'
    ],
    steps: [
      'Open the Exception page.',
      'Select the correct exception type.',
      'Enter the Picking List information.',
      'Enter the Container information.',
      'Enter the packer information.',
      'Enter the product barcode.',
      'Create the exception report.'
    ]
  },
  {
    title: '6. Original Location Counting Process',
    paragraphs: [
      'The Counter must physically verify the inventory at the original picked location as follows:',
      'When counted quantities are entered while editing an exception report, Count By USID is required.'
    ],
    steps: [
      'Complete the required missing information in the exception report, such as picker and original picked location.',
      'Print the exception sheet.',
      'Go to the original picked location.',
      'Count the actual inventory at that location.',
      'Enter System Qty.',
      'Enter Actual.',
      'Enter the counter in Count By USID.'
    ]
  },
  {
    title: '7. Under-Pick Decision Standard',
    paragraphs: [
      'To avoid delaying outbound progress, when a Packer or Rebin operator finds an exception at the packing station or Rebin station, they only need to record the following key information first:',
      'The reporting process should not cause the Packer or Rebin operator to be idle for more than 3 minutes.',
      'If a shortage is found during Rebin, print the exception sheet first so the Rebin operator can continue the sorting process. Keep the exception sheet properly and place it in the correct sorting slot.',
      'After the above actions are completed, the exception operator handles the follow-up investigation. The exception operator must verify the original picked location quantity first, then process the exception based on the standards below:'
    ],
    bullets: ['Picking List', 'Container', 'Product barcode'],
    table: {
      columns: ['Original Location Count', 'Meaning', 'Action'],
      rows: [
        ['Actual > System', 'Actual inventory at the original location is greater than the system quantity. This means the item is still at the original location and the picker under-picked.', 'Physically retrieve the item from the original location and complete the exception. The system automatically records responsibility as Picker. No inventory adjustment is required.'],
        ['Actual = System', 'Actual inventory at the original location matches the system quantity. The missing item must be replenished from inventory.', 'Select Extra Taken and enter the quantity. If actual inventory at the original location is 0, enter Borrowed Location and the borrowed quantity. Inventory adjustment is required afterward.'],
        ['Actual < System', 'Actual inventory at the original location is less than the system quantity. The location has an inventory discrepancy, and the order still needs replenishment.', 'Select Extra Taken or enter Borrowed Location. Inventory adjustment is required afterward.'],
        ['No stock available in the warehouse', 'The order cannot be completed from available inventory.', 'Keep the exception open, or mark it as Short Picked when the conditions are met. Do not force close it.']
      ]
    }
  },
  {
    title: '8. Extra Taken Rules',
    paragraphs: ['Extra Taken is used when a unit is taken from inventory to complete the order after the original picking shortage has been confirmed.', 'Rules:'],
    steps: [
      'Only applicable to under-pick or short-pick related workflows.',
      'Only allowed when the original location count result is Actual <= System.',
      'Do not use Extra Taken when Actual > System, because that result shows the item is still at the original location and supports Picker under-pick responsibility.',
      'After Extra Taken is used, inventory adjustment must be completed.',
      'The exception may enter Resolved status only after Inventory Adjustment = Yes.'
    ]
  },
  {
    title: '9. Borrowed Location Rules',
    paragraphs: ['Borrowed Location is used when stock is taken from another location to complete the order.', 'Rules:'],
    steps: [
      'Borrowed Location must be entered when replenishing from another location.',
      'When Borrowed Location is entered, Borrowed Qty must also be entered.',
      'Do not use stock from another location without recording the source location.',
      'After Borrowed Location is used, inventory adjustment must be completed.',
      'The exception may enter Resolved status only after Inventory Adjustment = Yes.'
    ]
  },
  {
    title: '10. Short Picked Rules',
    paragraphs: ['Short Picked is used only when the order cannot be completed from available inventory.', 'Rules:'],
    steps: [
      'The original picked location count must be completed first.',
      'It must be confirmed that no other usable inventory is available for replenishment.',
      'Only reports with the Short Pick exception type may be marked as Short Picked.',
      'Do not mark Short Picked when usable inventory is still available.',
      'Do not force mark Short Picked just to close the exception.'
    ]
  },
  {
    title: '11. Short Pick Handling Process',
    paragraphs: [
      'This section applies when a picker finds no stock at the assigned picking location.',
      'Critical rule:',
      'Regular pickers are not allowed to privately click or submit Short Pick.',
      'If a picker privately marks Short Pick without following this SOP, disciplinary action applies even when the shortage is later confirmed as valid: first violation = warning; second violation = termination.',
      'Correct short-pick process:'
    ],
    steps: [
      'Picker escalation: When a picker finds no stock at the picking location, the picker must not mark Short Pick directly. The picker must go to the Inventory team and request support.',
      'Exception creation by Inventory: The Inventory team creates an exception report with the exception type Short Pick. The report must include Picking List, Container, and the barcode of the short-picked product.',
      'Counting: The Counter or exception operator goes to the short-pick location, checks nearby locations for possible location drift or mis-slotting, and records System Qty, Actual, and Count By USID.',
      'Borrowed Location trigger: If Actual = 0 after counting, the Borrowed Location mechanism must be used to help the order ship normally when possible. The exception operator must check whether the same SKU exists elsewhere in the warehouse.',
      'Same SKU available: If the same SKU exists in another location, enter Borrowed Location and Borrowed Qty. The Inventory team must then complete the inventory decrease or adjustment for the borrowed item location.',
      'No usable stock available: If no usable same-SKU inventory is available in the warehouse, click Short Picked and complete the Short Pick action on the PDA so the PDA record stays synchronized with the exception report.'
    ]
  },
  {
    title: '12. Responsibility Assignment Rules',
    paragraphs: [
      'Admin assigns responsibility based on the count result, replenishment record, packing feedback, and system records.',
      'All Leads and exception operators must strictly follow this SOP.',
      'Responsibility assignment must be based on verified information. Do not close an exception based only on verbal explanation.',
      'Wrong-placement counts are permanently recorded by the system. Relevant operators are responsible according to the confirmed operation result.'
    ],
    table: {
      columns: ['Responsibility Option', 'Use Case'],
      rows: [
        ['Picker', 'Original location Actual > System, meaning the item is still at the original location and the picker did not pick the full quantity.'],
        ['Packing / Rebin', 'The item was picked correctly, but loss, misplacement, or an operation error occurred during packing or Rebin.'],
        ['All Responsible', 'Multiple process steps have confirmed issues, such as both picking and packing record errors.'],
        ['No Responsibility', 'The issue is confirmed as a system inventory discrepancy, historical inventory issue, or cannot be assigned to a specific operator.']
      ]
    }
  },
  {
    title: '13. Admin Closeout Requirements',
    paragraphs: ['Admin may only close exception reports in Resolved status.', 'Before closing, Admin must confirm that the following items are complete:'],
    bullets: [
      'Product information is recorded.',
      'Original picked location is recorded.',
      'System Qty is entered.',
      'Actual is entered.',
      'Count By USID is entered.',
      'Picker information is recorded, if applicable.',
      'Packing / Rebin operator information is recorded, if applicable.',
      'Inventory adjustment is completed when Extra Taken is used.',
      'Source location, quantity, and inventory adjustment are completed when Borrowed Location is used.',
      'No available replenishment stock has been confirmed when Short Picked is used.',
      'The responsibility decision matches the verified cause.'
    ]
  },
  {
    title: '14. Exception Closeout Process',
    steps: [
      'Admin reviews the exception report.',
      'Confirm that count information is complete.',
      'Confirm the replenishment method and inventory adjustment status.',
      'Verify that the exception meets the requirements for Resolved or Short Picked.',
      'Select the responsibility assignment.',
      'Close the exception report.'
    ]
  },
  {
    title: '15. Notes',
    steps: [
      'Counting does not need to be completed immediately when creating the exception, but all required information must be completed before closeout.',
      'After a shortage is found, do not take product directly and skip the exception record.',
      'When using inventory from another location, the source location and quantity must be recorded.',
      'Exceptions requiring inventory adjustment must not be closed before the adjustment is complete.',
      'When no stock is available, do not force mark the exception as resolved.',
      'Responsibility assignment must match the count result and processing record.'
    ]
  }
];
