function create_process_id(parent_id, id_ending) {
	/**
	 * Creates the ID for a new process
	 * @param  {String} parent_id ID of the parent graph.
	 *                          Null if creating ID for system process.
	 * @param  {Integer} id_ending (Optional) The number ending for the ID.
	 * @return {String} New Process ID.
	 */
	// ID for the system process
	if (parent_id == null) return "0";

	// If no ending, increment number of processes
	if (typeof id_ending === "undefined") {
		let current_graph = editor.graph.getModel();
		let graph_cells = current_graph.cells;
		let process_cells = [];
		for (cell in graph_cells)
			if (graph_cells[cell].item_type == "process")
				process_cells.push(cell);
		id_ending = process_cells.length + 1;
	}

	if (parent_id == "0") return id_ending.toString();
	else return `${parent_id}.${id_ending}`;
}

function update_process_ids(parent_id, graph) {
	/**
	 * Updates the process id's for each process and its sub processes
	 * @param  {String} parent_id ID of the parent graph.
	 * @param  {Object} graph MxGraph model to update
	 */
	let process_counter = 1;

	// Update each process in the graph
	for (key in graph.cells) {
		let cell = graph.cells[key];
		if (cell.item_type && cell.item_type == "process") {
			let new_id = create_process_id(parent_id, process_counter);

			// Update process id in graph model
			cell.children[0].value = new_id;

			// Update process id in hierarch data structure
			try {
				let process_name = editor.graph.convertValueToString(cell);
				let process = get_hierarchy_diagram(process_name);
				process.process_id = new_id;

				// Recursively update the ids of sub processes
				update_process_ids(process.process_id, process.graph_model);
			} catch {}
			process_counter++;
		}
	}

	// Update changes
	editor.graph.refresh();
}

function add_entity(entity_cell, process_name, visited) {
	/**
	 * Adds a entity to all parent processes and connected sub processes
	 * @param  {Object} entity_cell The entity cell being added
	 * @param  {String} process_name The name of the process the entity is being added to
	 * @param  {Set} visited Set of the names of already visited processes
	 * 					Used to prevent cycles when traversing the DFD
	 */

	// Check if already visited
	if (visited.has(process_name)) return;
	visited.add(process_name);

	// Add entity in parent process
	let process = get_hierarchy_diagram(process_name);
	if (process.parent_name)
		add_entity(entity_cell, process.parent_name, visited);

	// Add entity to all connected sub processes
	let sub_processes = find_connecting_cells(entity_cell, "process");

	sub_processes.forEach(process => {
		// Add entity to subprocess if exists
		try {
			get_hierarchy_diagram(process.value.getAttribute("label"));
			add_entity(
				entity_cell,
				process.value.getAttribute("label"),
				visited
			);
		} catch {}
	});

	// Add entity to process
	let current_graph = process.graph_model;

	/* Check if entity is already in the graph */
	if (
		find_cell_in_graph(
			current_graph,
			entity_cell.value.getAttribute("label"),
			"entity"
		)
	)
		return;

	let parent = current_graph.getChildAt(current_graph.getRoot(), 0);
	current_graph.add(parent, entity_cell.clone());
}

function remove_entity(entity_name) {
	/**
	 * Removes all occurrences of an entity in the DFD
	 * @param  {String} entity_name Name of the entity to remove
	 */
	// Find all occurrences of the entity
	let occurrences = find_all_entity_occurrences(entity_name, hierarchy);

	// Remove all entities
	occurrences.forEach(occurrence => {
		let graph = get_hierarchy_diagram(occurrence).graph_model;
		let cell = find_cell_in_graph(graph, entity_name, "entity");

		/* Remove entity from current graph */
		let remove_graph = new mxGraph(null, graph);
		try {
			remove_graph.getModel().beginUpdate();
			if (remove_graph.getModel().isVertex(cell))
				remove_graph.removeCells([cell]);
		} catch {
		} finally {
			remove_graph.getModel().endUpdate();
		}
		set_hierarchy_diagram(occurrence, {
			new_model: remove_graph.getModel()
		});
	});
}

function validate_cell_type(cell_type) {
	/**
	 * Validates cell type
	 * @param {String} cell_type Type of cell
	 * @throws Exception if invalid cell type
	 */
	let valid_cell_types = ["entity", "process", "datastore"];
	if (!valid_cell_types.includes(cell_type))
		throw `Invalid cell_type: ${cell_type}. Must be in ${valid_cell_types}.`;
}

function is_valid_label_change(cell, value, evt) {
	/**
	 * Validates a cell label change. Executes the event if valid, alerts the user if not
	 * @param {Object} cell The cell being edited
	 * @param {String} value The new value of the cell
	 * @param {Object} event Label edit event
	 */
	// Validate process label change
	// TODO validate flow label change
	[
		["process", is_valid_process_name],
		["entity", is_valid_entity_name]
	].forEach(inputs => {
		let [item_type, validation_function] = inputs;
		if (cell.item_type == item_type) {
			let validation_result = validation_function(value);
			if (validation_result[0]) {
				if (mxUtils.isNode(cell.value)) {
					// Clones the value for correct undo/redo
					var elt = cell.value.cloneNode(true);
					elt.setAttribute("label", value);
					value = elt;
				}
				mxGraphLabelChanged.apply(this, arguments);
			} else {
				alert(`Error: ${validation_result[1]}`);
			}
		}
	});
}

function is_valid_process_name(name) {
	/**
	 * Determines if valid new process name
	 * @param  {String} name The new name of the process
	 * @return {Boolean} If the new name is valid
	 * @return {String}  Error message if not valid
	 */
	// Validate name input
	if (!name || name.length == 0)
		return [false, "Unable to have null or empty name"];

	// Validate is not already in DFD
	let search_result = is_process_in_hierarchy(name, hierarchy);
	if (search_result)
		return [
			false,
			`Process with name ${name} already exists in ${search_result}`
		];

	return [true];
}

function is_valid_entity_name(name) {
	/**
	 * Determines if valid new entity name
	 * @param  {String} name The new name of the process
	 * @return {Boolean} If the new name is valid
	 * @return {String}  Error message if not valid
	 */
	// TODO clarify if going to allow multiple entity names
	// Validate name input
	if (!name || name.length == 0)
		return [false, "Unable to have null or empty name"];
	return [true];
}

function update_process_name(sender, event) {
	/**
	 * Handles process name change. Update value is validate before executing the event.
	 * Updates the name of the process in the hierarchy data structure and hierarchy html list
	 * @param {Object} sender Sender of the event
	 * @param {Object} event Label changed event
	 */
	let previous_name = event.getProperty("old");
	let new_name = event.getProperty("value");

	// Check if process is in diagram hierarchy
	let process = null;
	try {
		process = get_hierarchy_diagram(previous_name);
	} catch {
		return;
	}

	// Update process details
	set_hierarchy_diagram(previous_name, { new_name });

	// Update hierarchy item
	let hierarchy_item_id =
		previous_name.replace(/[ ]/g, "_") + "_hierarchy_item";
	let list_item = document.getElementById(hierarchy_item_id);
	let list_item_title = list_item.getElementsByClassName(
		"hierarchy_item_title"
	)[0];
	/* update item id */
	list_item.id = new_name.replace(/[ ]/g, "_") + "_hierarchy_item";
	/* update name */
	list_item_title.innerText = new_name;
}

function update_entity_name(sender, event) {
	/**
	 * Handles entity name change. Update value is validate before executing the event.
	 * Updates the name of the entity in DFD
	 * @param {Object} sender Sender of the event
	 * @param {Object} event Label changed event
	 */
	let new_name = event.getProperty("value").getAttribute("label");
	let old_name = event.getProperty("old").getAttribute("label");

	// Find all occurrences of the entity
	let occurrences = find_all_entity_occurrences(old_name, hierarchy);

	// Change name of all entities
	occurrences.forEach(occurrence => {
		let graph = get_hierarchy_diagram(occurrence).graph_model;
		let cell = find_cell_in_graph(graph, old_name, "entity");
		cell.value.setAttribute("label", new_name);
	});
}

function set_validation_rules() {
	/**
	 * Sets validation rules for flows and set graph validation on change listener
	 */
	// A flow can't directly connect 2 entities
	editor.graph.multiplicities.push(
		new mxMultiplicity(
			false,
			"entity",
			null,
			null,
			null,
			null,
			["entity"],
			null,
			"Data cannot move directly from a source entity to a sink entity." +
				" It must be moved by a process.",
			false
		)
	);

	// A process must have at least one in flow of data
	editor.graph.multiplicities.push(
		new mxMultiplicity(
			false,
			"process",
			null,
			null,
			1,
			null,
			null,
			"A process must have at least one in flow of data."
		)
	);

	// A process must have at least one out flow of data
	editor.graph.multiplicities.push(
		new mxMultiplicity(
			true,
			"process",
			null,
			null,
			1,
			null,
			null,
			"A process must have at least one out flow of data."
		)
	);

	// A flow can't move data from a datastore to a entity
	editor.graph.multiplicities.push(
		new mxMultiplicity(
			true,
			"datastore",
			null,
			null,
			null,
			null,
			["entity"],
			null,
			"A data flow can't move directly from a data store to a entity." +
				" This data must be moved using a process.",
			false
		)
	);

	// A flow can't move data from a entity to a datastore
	editor.graph.multiplicities.push(
		new mxMultiplicity(
			false,
			"datastore",
			null,
			null,
			null,
			null,
			["entity"],
			null,
			"A data flow can't move directly from a data store to a entity." +
				" This data must be moved using a process.",
			false
		)
	);

	// Validates graph on every change event
	editor.validating = true;
}